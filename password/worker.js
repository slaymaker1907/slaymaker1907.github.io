!function(t){function e(r){if(n[r])return n[r].exports
var o=n[r]={i:r,l:!1,exports:{}}
return t[r].call(o.exports,o,o.exports,e),o.l=!0,o.exports}var n={}
e.m=t,e.c=n,e.d=function(t,n,r){e.o(t,n)||Object.defineProperty(t,n,{configurable:!1,enumerable:!0,get:r})},e.n=function(t){var n=t&&t.__esModule?function(){return t.default}:function(){return t}
return e.d(n,"a",n),n},e.o=function(t,e){return Object.prototype.hasOwnProperty.call(t,e)},e.p="",e(e.s=230)}({22:function(t,e){function n(){throw new Error("setTimeout has not been defined")}function r(){throw new Error("clearTimeout has not been defined")}function o(t){if(f===setTimeout)return setTimeout(t,0)
if((f===n||!f)&&setTimeout)return f=setTimeout,setTimeout(t,0)
try{return f(t,0)}catch(e){try{return f.call(null,t,0)}catch(e){return f.call(this,t,0)}}}function i(t){if(l===clearTimeout)return clearTimeout(t)
if((l===r||!l)&&clearTimeout)return l=clearTimeout,clearTimeout(t)
try{return l(t)}catch(e){try{return l.call(null,t)}catch(e){return l.call(this,t)}}}function u(){m&&h&&(m=!1,h.length?d=h.concat(d):v=-1,d.length&&a())}function a(){if(!m){var t=o(u)
m=!0
for(var e=d.length;e;){for(h=d,d=[];++v<e;)h&&h[v].run()
v=-1,e=d.length}h=null,m=!1,i(t)}}function c(t,e){this.fun=t,this.array=e}function s(){}var f,l,p=t.exports={}
!function(){try{f="function"==typeof setTimeout?setTimeout:n}catch(t){f=n}try{l="function"==typeof clearTimeout?clearTimeout:r}catch(t){l=r}}()
var h,d=[],m=!1,v=-1
p.nextTick=function(t){var e=new Array(arguments.length-1)
if(arguments.length>1)for(var n=1;n<arguments.length;n++)e[n-1]=arguments[n]
d.push(new c(t,e)),1!==d.length||m||o(a)},c.prototype.run=function(){this.fun.apply(null,this.array)},p.title="browser",p.browser=!0,p.env={},p.argv=[],p.version="",p.versions={},p.on=s,p.addListener=s,p.once=s,p.off=s,p.removeListener=s,p.removeAllListeners=s,p.emit=s,p.prependListener=s,p.prependOnceListener=s,p.listeners=function(t){return[]},p.binding=function(t){throw new Error("process.binding is not supported")},p.cwd=function(){return"/"},p.chdir=function(t){throw new Error("process.chdir is not supported")},p.umask=function(){return 0}},230:function(t,e,n){var r,o
r=[n,e,n(231)],void 0!==(o=function(t,e,n){"use strict"
Object.defineProperty(e,"__esModule",{value:!0}),onmessage=(t=>{const e=t.data
n(e.password,e.salt,e.options,t=>postMessage(t))})}.apply(e,r))&&(t.exports=o)},231:function(t,e,n){(function(e){t.exports=function(t,n,r,o,i,u,a,c){"use strict"
function s(t){function e(t){for(var e=0,p=t.length;p>=64;){var h,d,m,v,g,y=r,w=o,T=i,b=u,I=a,E=c,_=s,A=f
for(d=0;d<16;d++)m=e+4*d,l[d]=(255&t[m])<<24|(255&t[m+1])<<16|(255&t[m+2])<<8|255&t[m+3]
for(d=16;d<64;d++)v=((h=l[d-2])>>>17|h<<15)^(h>>>19|h<<13)^h>>>10,g=((h=l[d-15])>>>7|h<<25)^(h>>>18|h<<14)^h>>>3,l[d]=(v+l[d-7]|0)+(g+l[d-16]|0)|0
for(d=0;d<64;d++)v=(((I>>>6|I<<26)^(I>>>11|I<<21)^(I>>>25|I<<7))+(I&E^~I&_)|0)+(A+(n[d]+l[d]|0)|0)|0,g=((y>>>2|y<<30)^(y>>>13|y<<19)^(y>>>22|y<<10))+(y&w^y&T^w&T)|0,A=_,_=E,E=I,I=b+v|0,b=T,T=w,w=y,y=v+g|0
r=r+y|0,o=o+w|0,i=i+T|0,u=u+b|0,a=a+I|0,c=c+E|0,s=s+_|0,f=f+A|0,e+=64,p-=64}}var n=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298],r=1779033703,o=3144134277,i=1013904242,u=2773480762,a=1359893119,c=2600822924,s=528734635,f=1541459225,l=new Array(64)
e(t)
var p,h=t.length%64,d=t.length/536870912|0,m=t.length<<3,v=h<56?56:120,g=t.slice(t.length-h,t.length)
for(g.push(128),p=h+1;p<v;p++)g.push(0)
return g.push(d>>>24&255),g.push(d>>>16&255),g.push(d>>>8&255),g.push(d>>>0&255),g.push(m>>>24&255),g.push(m>>>16&255),g.push(m>>>8&255),g.push(m>>>0&255),e(g),[r>>>24&255,r>>>16&255,r>>>8&255,r>>>0&255,o>>>24&255,o>>>16&255,o>>>8&255,o>>>0&255,i>>>24&255,i>>>16&255,i>>>8&255,i>>>0&255,u>>>24&255,u>>>16&255,u>>>8&255,u>>>0&255,a>>>24&255,a>>>16&255,a>>>8&255,a>>>0&255,c>>>24&255,c>>>16&255,c>>>8&255,c>>>0&255,s>>>24&255,s>>>16&255,s>>>8&255,s>>>0&255,f>>>24&255,f>>>16&255,f>>>8&255,f>>>0&255]}function f(t,e,n){function r(){for(var t=i-1;t>=i-4;t--){if(u[t]++,u[t]<=255)return
u[t]=0}}t=t.length<=64?t:s(t)
var o,i=64+e.length+4,u=new Array(i),a=new Array(64),c=[]
for(o=0;o<64;o++)u[o]=54
for(o=0;o<t.length;o++)u[o]^=t[o]
for(o=0;o<e.length;o++)u[64+o]=e[o]
for(o=i-4;o<i;o++)u[o]=0
for(o=0;o<64;o++)a[o]=92
for(o=0;o<t.length;o++)a[o]^=t[o]
for(;n>=32;)r(),c=c.concat(s(a.concat(s(u)))),n-=32
return n>0&&(r(),c=c.concat(s(a.concat(s(u))).slice(0,n))),c}function l(t,e,n,r){var o,i,u=t[0]^e[n++],a=t[1]^e[n++],c=t[2]^e[n++],s=t[3]^e[n++],f=t[4]^e[n++],l=t[5]^e[n++],p=t[6]^e[n++],h=t[7]^e[n++],d=t[8]^e[n++],m=t[9]^e[n++],v=t[10]^e[n++],g=t[11]^e[n++],y=t[12]^e[n++],w=t[13]^e[n++],T=t[14]^e[n++],b=t[15]^e[n++],I=u,E=a,_=c,A=s,x=f,M=l,N=p,j=h,k=d,O=m,L=v,C=g,F=y,P=w,S=T,U=b
for(i=0;i<8;i+=2)I^=(o=(F^=(o=(k^=(o=(x^=(o=I+F)<<7|o>>>25)+I)<<9|o>>>23)+x)<<13|o>>>19)+k)<<18|o>>>14,M^=(o=(E^=(o=(P^=(o=(O^=(o=M+E)<<7|o>>>25)+M)<<9|o>>>23)+O)<<13|o>>>19)+P)<<18|o>>>14,L^=(o=(N^=(o=(_^=(o=(S^=(o=L+N)<<7|o>>>25)+L)<<9|o>>>23)+S)<<13|o>>>19)+_)<<18|o>>>14,U^=(o=(C^=(o=(j^=(o=(A^=(o=U+C)<<7|o>>>25)+U)<<9|o>>>23)+A)<<13|o>>>19)+j)<<18|o>>>14,I^=(o=(A^=(o=(_^=(o=(E^=(o=I+A)<<7|o>>>25)+I)<<9|o>>>23)+E)<<13|o>>>19)+_)<<18|o>>>14,M^=(o=(x^=(o=(j^=(o=(N^=(o=M+x)<<7|o>>>25)+M)<<9|o>>>23)+N)<<13|o>>>19)+j)<<18|o>>>14,L^=(o=(O^=(o=(k^=(o=(C^=(o=L+O)<<7|o>>>25)+L)<<9|o>>>23)+C)<<13|o>>>19)+k)<<18|o>>>14,U^=(o=(S^=(o=(P^=(o=(F^=(o=U+S)<<7|o>>>25)+U)<<9|o>>>23)+F)<<13|o>>>19)+P)<<18|o>>>14
e[r++]=t[0]=I+u|0,e[r++]=t[1]=E+a|0,e[r++]=t[2]=_+c|0,e[r++]=t[3]=A+s|0,e[r++]=t[4]=x+f|0,e[r++]=t[5]=M+l|0,e[r++]=t[6]=N+p|0,e[r++]=t[7]=j+h|0,e[r++]=t[8]=k+d|0,e[r++]=t[9]=O+m|0,e[r++]=t[10]=L+v|0,e[r++]=t[11]=C+g|0,e[r++]=t[12]=F+y|0,e[r++]=t[13]=P+w|0,e[r++]=t[14]=S+T|0,e[r++]=t[15]=U+b|0}function p(t,e,n,r,o){for(;o--;)t[e++]=n[r++]}function h(t,e,n,r,o){for(;o--;)t[e++]^=n[r++]}function d(t,e,n,r,o){p(t,0,e,n+16*(2*o-1),16)
for(var i=0;i<2*o;i+=2)l(t,e,n+16*i,r+8*i),l(t,e,n+16*i+16,r+8*i+16*o)}function m(t,e,n){return t[e+16*(2*n-1)]}function v(t){for(var e=[],n=0;n<t.length;n++){var r=t.charCodeAt(n)
r<128?e.push(r):r>127&&r<2048?(e.push(r>>6|192),e.push(63&r|128)):(e.push(r>>12|224),e.push(r>>6&63|128),e.push(63&r|128))}return e}function g(t){for(var e="0123456789abcdef".split(""),n=t.length,r=[],o=0;o<n;o++)r.push(e[t[o]>>>4&15]),r.push(e[t[o]>>>0&15])
return r.join("")}function y(t){for(var e,n="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split(""),r=t.length,o=[],i=0;i<r;)e=((i<r?t[i++]:0)<<16)+((i<r?t[i++]:0)<<8)+(i<r?t[i++]:0),o.push(n[e>>>18&63]),o.push(n[e>>>12&63]),o.push(n[e>>>6&63]),o.push(n[e>>>0&63])
return r%3>0&&(o[o.length-1]="=",r%3==1&&(o[o.length-2]="=")),o.join("")}function w(t){for(var e=0;e<32*o;e++){var n=t+4*e
N[C+e]=(255&k[n+3])<<24|(255&k[n+2])<<16|(255&k[n+1])<<8|(255&k[n+0])<<0}}function T(t,e){for(var n=t;n<e;n+=2)p(j,n*(32*o),N,C,32*o),d(O,N,C,F,o),p(j,(n+1)*(32*o),N,F,32*o),d(O,N,F,C,o)}function b(t,e){for(var n=t;n<e;n+=2){var r=m(N,C,o)&L-1
h(N,C,j,r*(32*o),32*o),d(O,N,C,F,o),r=m(N,F,o)&L-1,h(N,F,j,r*(32*o),32*o),d(O,N,F,C,o)}}function I(t){for(var e=0;e<32*o;e++){var n=N[C+e]
k[t+4*e+0]=n>>>0&255,k[t+4*e+1]=n>>>8&255,k[t+4*e+2]=n>>>16&255,k[t+4*e+3]=n>>>24&255}}function E(t,e,n,r,o){!function i(){P(function(){r(t,t+n<e?t+n:e),(t+=n)<e?i():o()})}()}function _(e){var n=f(t,k,i)
return"base64"===e?y(n):"hex"===e?g(n):"binary"===e?new Uint8Array(n):n}function A(t){w(128*t*o),E(0,L,2*u,T,function(){E(0,L,2*u,b,function(){I(128*t*o),t+1<x?P(function(){A(t+1)}):a(_(c))})})}var x=1
if("object"==typeof r){if(arguments.length>4)throw new Error("scrypt: incorrect number of arguments")
var M=r
if(a=o,void 0===(r=M.logN)){if(void 0===M.N)throw new Error("scrypt: missing N parameter")
if(M.N<2||M.N>-1>>>0)throw new Error("scrypt: N is out of range")
if(0!=(M.N&M.N-1))throw new Error("scrypt: N is not a power of 2")
r=Math.log(M.N)/Math.LN2}x=M.p||1,o=M.r,i=M.dkLen||32,u=M.interruptStep||0,c=M.encoding}if(x<1)throw new Error("scrypt: invalid p")
if(o<=0)throw new Error("scrypt: invalid r")
if(r<1||r>31)throw new Error("scrypt: logN must be between 1 and 31")
var N,j,k,O,L=1<<r>>>0
if(o*x>=1<<30||o>(-1>>>0)/128/x||o>(-1>>>0)/256||L>(-1>>>0)/128/o)throw new Error("scrypt: parameters are too large")
"string"==typeof t&&(t=v(t)),"string"==typeof n&&(n=v(n)),"undefined"!=typeof Int32Array?(N=new Int32Array(64*o),j=new Int32Array(32*L*o),O=new Int32Array(16)):(N=[],j=[],O=new Array(16)),k=f(t,n,128*x*o)
var C=0,F=32*o,P=void 0!==e?e:setTimeout
"function"==typeof u&&(c=a,a=u,u=1e3),u<=0?function(){for(var t=0;t<x;t++)w(128*t*o),T(0,L),b(0,L),I(128*t*o)
a(_(c))}():A(0)}}).call(e,n(232).setImmediate)},232:function(t,e,n){function r(t,e){this._id=t,this._clearFn=e}var o=Function.prototype.apply
e.setTimeout=function(){return new r(o.call(setTimeout,window,arguments),clearTimeout)},e.setInterval=function(){return new r(o.call(setInterval,window,arguments),clearInterval)},e.clearTimeout=e.clearInterval=function(t){t&&t.close()},r.prototype.unref=r.prototype.ref=function(){},r.prototype.close=function(){this._clearFn.call(window,this._id)},e.enroll=function(t,e){clearTimeout(t._idleTimeoutId),t._idleTimeout=e},e.unenroll=function(t){clearTimeout(t._idleTimeoutId),t._idleTimeout=-1},e._unrefActive=e.active=function(t){clearTimeout(t._idleTimeoutId)
var e=t._idleTimeout
e>=0&&(t._idleTimeoutId=setTimeout(function(){t._onTimeout&&t._onTimeout()},e))},n(233),e.setImmediate=setImmediate,e.clearImmediate=clearImmediate},233:function(t,e,n){(function(t,e){!function(t,n){"use strict"
function r(t){delete c[t]}function o(t){var e=t.callback,r=t.args
switch(r.length){case 0:e()
break
case 1:e(r[0])
break
case 2:e(r[0],r[1])
break
case 3:e(r[0],r[1],r[2])
break
default:e.apply(n,r)}}function i(t){if(s)setTimeout(i,0,t)
else{var e=c[t]
if(e){s=!0
try{o(e)}finally{r(t),s=!1}}}}if(!t.setImmediate){var u,a=1,c={},s=!1,f=t.document,l=Object.getPrototypeOf&&Object.getPrototypeOf(t)
l=l&&l.setTimeout?l:t,"[object process]"==={}.toString.call(t.process)?u=function(t){e.nextTick(function(){i(t)})}:function(){if(t.postMessage&&!t.importScripts){var e=!0,n=t.onmessage
return t.onmessage=function(){e=!1},t.postMessage("","*"),t.onmessage=n,e}}()?function(){var e="setImmediate$"+Math.random()+"$",n=function(n){n.source===t&&"string"==typeof n.data&&0===n.data.indexOf(e)&&i(+n.data.slice(e.length))}
t.addEventListener?t.addEventListener("message",n,!1):t.attachEvent("onmessage",n),u=function(n){t.postMessage(e+n,"*")}}():t.MessageChannel?function(){var t=new MessageChannel
t.port1.onmessage=function(t){i(t.data)},u=function(e){t.port2.postMessage(e)}}():f&&"onreadystatechange"in f.createElement("script")?function(){var t=f.documentElement
u=function(e){var n=f.createElement("script")
n.onreadystatechange=function(){i(e),n.onreadystatechange=null,t.removeChild(n),n=null},t.appendChild(n)}}():u=function(t){setTimeout(i,0,t)},l.setImmediate=function(t){"function"!=typeof t&&(t=new Function(""+t))
for(var e=new Array(arguments.length-1),n=0;n<e.length;n++)e[n]=arguments[n+1]
var r={callback:t,args:e}
return c[a]=r,u(a),a++},l.clearImmediate=r}}("undefined"==typeof self?void 0===t?this:t:self)}).call(e,n(30),n(22))},30:function(t,e){var n
n=function(){return this}()
try{n=n||Function("return this")()||(0,eval)("this")}catch(t){"object"==typeof window&&(n=window)}t.exports=n}})

//# sourceMappingURL=worker.js.map