// Taken from https://konklone.com/post/github-pages-now-sorta-supports-https-so-use-it
var host = "slaymaker1907.github.io";
if ((host == window.location.host) && (window.location.protocol != "https:"))
    window.location.protocol = "https";
