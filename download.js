#!/usr/bin/env node
import fs from 'fs';
import { Readable } from 'stream';
import puppeteer from 'puppeteer-core';
const date = '2026-09-25';
const tt = 'tt27543632';
const directory = `assets/${date} ${tt}`;
await fs.promises.mkdir(directory, { recursive: true });
const cookies = await fs.promises.readFile('cookies.json').then(JSON.parse);
const browser = await puppeteer.launch({
	executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
	defaultViewport: { width: 1024, height: 1400 },
});
await browser.setCookie(...cookies);
const page = await browser.newPage();
await page.setUserAgent({userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'});
await page.setExtraHTTPHeaders({'accept-language': 'en,en-US;q=0.9,zh-CN;q=0.8,zh-TW;q=0.7,zh;q=0.6', referer: 'https://www.imdb.com/'}); // This language header will affect the returned value of title and the returned url of poster image.
await page.goto(`https://www.imdb.com/title/${tt}/`, { waitUntil: 'networkidle0', timeout: 60000 });
if (await page.title() === 'Human Verification') {
	const gokuProps = await page.evaluate(() => window.gokuProps);
	const scripts = await page.evaluate(() => Array.from(document.querySelectorAll('head > script')).filter(script => script.hasAttribute('src')).map(script => script.src));
	const createTaskResponse = await fetch('https://api.2captcha.com/createTask', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			clientKey: 'ecad7fdc7d521384a5c260199582de72',//process.env.2CAPTCHA_API_KEY,
			task: {
				type: "AmazonTaskProxyless",
				websiteURL: `https://www.imdb.com/title/${tt}/`,
				challengeScript: scripts[0],
				captchaScript: scripts[1],
				websiteKey: gokuProps.key,
				context: gokuProps.context,
				iv: gokuProps.iv,
			},
		}),
    });
    console.assert(createTaskResponse.ok, 'createTaskResponse.ok');
    const task = await createTaskResponse.json();
	console.assert(task.errorId === 0, 'task.errorId === 0', task);
	let solution;
	while (true) {
		const getTaskResultResponse = await fetch('https://api.2captcha.com/getTaskResult', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				clientKey: process.env.TWOCAPTCHA_API_KEY,
				taskId: task.taskId,
			}),
		});
		console.assert(getTaskResultResponse.ok, 'getTaskResultResponse.ok');
		const result = await getTaskResultResponse.json();
		if (result.errorId === 0 && result.status === 'processing') {
			await new Promise(resolve => setTimeout(resolve, 5000)); // Wait at least 5 seconds and repeat the request.
		} else {
			if (result.errorId === 0 && result.status === 'ready') {
				solution = result.solution;
			} else {
				console.error(result);
			}
			break;
		}
	}
	if (!solution) {
		await browser.close();
		process.exit();
	}
	cookies.find(cookie => cookie.name === 'aws-waf-token' && cookie.domain === '.imdb.com').value = solution.existing_token;
	await fs.promises.writeFile('cookies.json', JSON.stringify(cookies, null, '	'));
	await browser.setCookie(...cookies);
	await page.goto(`https://www.imdb.com/title/${tt}/`, { waitUntil: 'networkidle0', timeout: 60000 });
}
await new Promise(resolve => setTimeout(resolve, 1400));
const cast = await page.$('div.title-cast__grid > div.ipc-shoveler__grid');
await cast.evaluate(div => {
	const elements = div.querySelectorAll('div[data-testid="title-cast-item"]');
	for (let i = 10; i < elements.length; ++i) elements[i].remove(); // Retain only the first 10 <div> tags. Remove the others.
}, cast);
await cast.screenshot({ path: `${directory}/cast.png` });
await cast.dispose();
const title = await page.$eval('span.hero__primary-text', el => el.innerText);
let year = await page.$eval('ul.sc-b41e510f-3 > li', el => el.innerText); // Sometimes 'TV Movie' is returned. In this case, get the second <li>.
if (year.length !== 4) year = await page.$eval('ul.sc-b41e510f-3 > li:nth-child(2)', el => el.innerText);
const plot = await page.$eval('span[data-testid="plot-xl"]', el => el.innerText);
const directors = await page.$$eval('div.sc-6339114b-3 > ul > li:nth-child(1) > div > ul > li', elements => elements.map(el => el.innerText));
const stars = await page.$$eval('div.sc-6339114b-3 > ul > li:nth-child(3) > div > ul > li', elements => elements.map(el => el.innerText));
const posterUrl = await page.$eval('img.ipc-image', el => el.src).then(url => `${url.split('_')[0]}jpg`);
const previewUrl = await page.$eval('div.jw-preview', el => el.style.cssText.split('"')[1]).then(url => `${url.split('_')[0]}jpg`).catch(e => undefined);
let trailerUrl;
const trailerPageUrl = await page.$eval('a.sc-9e7a6c35-0', el => el.href.split('?')[0]).catch(e => undefined);
if (trailerPageUrl) {
	await page.goto(trailerPageUrl, { waitUntil: 'networkidle2' });
	trailerUrl = await page.$eval('video', el => el.src);
}
await page.close();
await browser.close();
const files = [
	{ filename: 'poster.jpg', url: posterUrl },
];
if (previewUrl) files.push({ filename: 'preview.jpg', url: previewUrl });
if (trailerUrl) files.push({ filename: 'trailer.mp4', url: trailerUrl });
await Promise.all(files.map(async file => { // To change Promise.all to sequential loop, use (const file of files)
	const { filename, url } = file;
	const filepath = `${directory}/${filename}`;
	if (fs.existsSync(filepath)) return;
	let response;
	for (let i = 0; i < 5; ++i) { // Retry fetch(), to ensure successful fetching.
		try {
			response = await fetch(url); // Fetching previewUrl or trailerUrl may occasionally throw ETIMEOUT or ENETUNREACH.
			break;
		} catch {}
	}
	console.assert(response, file);
	Readable.fromWeb(response.body).pipe(fs.createWriteStream(filepath));
}));
await fs.promises.appendFile('movies.tsv', `${date}	${tt}	${title}	${year}	${directors}	${stars}	${plot}\n`);
