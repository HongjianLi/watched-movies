# watched-movies
I have watched hundreds of movies since 2013. To organize them, I created this repository.

## Backend

### download.js
Crawl IMDb pages to extract movie title, year, directors, stars, plot, top cast, poster image, trailer video.

### concat.js
Concat multiple poster images vertically, for publishing to WeChat Moments.  
This script requires tfjs-node, which requires util_1.isNullOrUndefined(), which has been removed in node v24. So this script requires node v22 to run.

## Frontend

### index.html
Show a table of movies and a table of images/videos.
