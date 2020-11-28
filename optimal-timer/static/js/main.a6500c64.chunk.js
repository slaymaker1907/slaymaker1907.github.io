(this["webpackJsonpoptimal-timer"]=this["webpackJsonpoptimal-timer"]||[]).push([[0],{102:function(e,t,n){},103:function(e,t,n){},112:function(e,t,n){"use strict";n.r(t);var a=n(7),r=n(0),i=n.n(r),o=n(11),c=n.n(o),s=(n(102),n(76)),l=n(50),u=n(16),m=n(22),j=(n(103),n(14)),d=n(69),b=n(159),f=n(12),O=n(149),h=n(164),g=n(153),v=n(154),p=n(160),x=n(168),T=n(155),S=n(163),w=n(161),y=n(113),k=n(157),D=n(158),N=n(74),C=n.n(N),E=n(75),I=n.n(E),M=n(146);function W(e){var t=f.Duration.fromObject({seconds:e}).shiftTo("days","hours","minutes","seconds");return t.days>0?t.toFormat("d 'days' h 'hours' m 'minutes' s 'seconds'"):t.hours>0?t.toFormat("h 'hours' m 'minutes' s 'seconds'"):t.minutes>0?t.toFormat("m 'minutes' s 'seconds'"):t.toFormat("s 'seconds'")}var F=Object(M.a)((function(e){return{root:{"& > *":{margin:e.spacing(1)},marginLeft:e.spacing(4),marginRight:e.spacing(4),marginTop:e.spacing(4)},outputText:{fontSize:"1rem"}}})),L=Object(M.a)((function(e){return{addTimerButton:{marginLeft:e.spacing(4),marginRight:e.spacing(4)}}})),A="timers";function B(e){return e/Math.max(1,Math.log(e))}function G(e){if(e<Math.E*Math.E)return e;var t=Math.log(e);return e/(t*t)}function J(e){return e>0?Math.sqrt(e):0}function P(e){return Math.max(e,0)}function R(e){var t,n=F(),i=Object(r.useState)(e.defaultStartTime),o=Object(m.a)(i,2),c=o[0],s=o[1],l=Object(r.useState)(f.DateTime.local()),u=Object(m.a)(l,2),j=u[0],d=u[1],D=Object(r.useState)(e.defaultGranularity),N=Object(m.a)(D,2),E=N[0],M=N[1],L=Object(r.useState)(e.defaultDivisor),A=Object(m.a)(L,2),R=A[0],U=A[1],q=Object(r.useState)(R.toString()),z=Object(m.a)(q,2),V=z[0],$=z[1],_=Object(r.useState)(e.defaultTimerName),H=Object(m.a)(_,2),K=H[0],Q=H[1],X=Object(r.useState)(e.defaultAlgorithmStr||B.name),Y=Object(m.a)(X,2),Z=Y[0],ee=Y[1],te=[B,G,J,P].filter((function(e){return e.name===Z})).concat(B.name)[0],ne=f.Interval.fromDateTimes(c,j),ae=ne.isValid?ne.toDuration().shiftTo("seconds").seconds:0;switch(Object(r.useEffect)((function(){var e=setTimeout((function(){return d(new Date)}),1e3);return function(){return clearTimeout(e)}})),Object(r.useEffect)((function(){e.onChange({startTime:c,granularity:E,divisor:R,timerName:K,algorithmStr:Z})}),[c,E,R,K,Z]),Object(r.useEffect)((function(){try{var e=parseInt(V);!isNaN(e)&&isFinite(e)&&e>0?U(e):console.log("Not updating to invalid divisor [%o].",e)}catch(t){console.log("Not updating divisor to non-number [%o] due to exception. %o",V,t)}}),[V]),E){case"seconds":t=1;break;case"minutes":t=60;break;case"hours":t=3600;break;default:console.log(E),alert("Error, invalid granularity: ".concat(E))}var re=te(ae/t/R)*R*t,ie=f.DateTime.local().plus(f.Duration.fromObject({seconds:re}));return Object(a.jsxs)(O.a,{className:n.root,children:[Object(a.jsx)(h.a,{label:"Timer name",value:K,onChange:function(e){return Q(e.target.value)}}),Object(a.jsx)(b.a,{label:"Start time",value:c,onChange:s,disableFuture:!0,openTo:"hours"}),Object(a.jsxs)(g.a,{children:[Object(a.jsx)(v.a,{children:"Granularity"}),Object(a.jsxs)(p.a,{value:E,onChange:function(e){return M(e.target.value)},children:[Object(a.jsx)(x.a,{value:"seconds",children:"seconds"}),Object(a.jsx)(x.a,{value:"minutes",children:"minutes"}),Object(a.jsx)(x.a,{value:"hours",children:"hours"})]})]}),Object(a.jsx)(h.a,{type:"number",label:"Divisor",value:V,onChange:function(e){return $(e.target.value)}}),Object(a.jsx)(T.a,{variant:"contained",onClick:function(){return s(f.DateTime.local())},color:"primary",startIcon:Object(a.jsx)(C.a,{}),children:"Now"}),Object(a.jsx)(T.a,{variant:"contained",onClick:e.onClose,color:"secondary",startIcon:Object(a.jsx)(I.a,{}),children:"Delete"}),Object(a.jsx)("div",{children:Object(a.jsxs)(g.a,{component:"fieldset",children:[Object(a.jsx)(y.a,{component:"legend",children:"Wait Algorithm"}),Object(a.jsxs)(S.a,{row:!0,value:Z,onChange:function(e){return ee(e.target.value)},children:[Object(a.jsx)(k.a,{value:B.name,control:Object(a.jsx)(w.a,{color:"primary"}),label:"Log"}),Object(a.jsx)(k.a,{value:G.name,control:Object(a.jsx)(w.a,{color:"primary"}),label:"Log\xb2"}),Object(a.jsx)(k.a,{value:J.name,control:Object(a.jsx)(w.a,{color:"primary"}),label:"Square Root"}),Object(a.jsx)(k.a,{value:P.name,control:Object(a.jsx)(w.a,{color:"primary"}),label:"Identity"})]})]})}),Object(a.jsxs)("div",{className:n.outputText,children:[Object(a.jsxs)("p",{children:["Time Waited: ",W(ae)]}),Object(a.jsxs)("p",{children:["Time to Wait: ",W(re)]}),Object(a.jsxs)("p",{children:["Wait Until: ",ie.toLocaleString(f.DateTime.DATETIME_MED)]})]})]})}var U=function(){var e=L(),t=function(){return{defaultStartTime:f.DateTime.local(),defaultGranularity:"minutes",defaultDivisor:1,defaultTimerName:""}},n=Object(r.useState)((function(){var e=localStorage.getItem(A);if(e){for(var n=JSON.parse(e),a=0,r=Object.entries(n.timers);a<r.length;a++){var i=Object(m.a)(r[a],2),o=i[0],c=i[1];n.timers[o]=Object(u.a)(Object(u.a)({},c),{},{defaultStartTime:f.DateTime.fromISO(c.defaultStartTime)})}return n}return{timers:{0:t()}}})),i=Object(m.a)(n,2),o=i[0],c=i[1];Object(r.useEffect)((function(){var e=Object(u.a)({},o);e.timers={};for(var t=0,n=Object.entries(o.timers);t<n.length;t++){var a=Object(m.a)(n[t],2),r=a[0],i=a[1];e.timers[r]=Object(u.a)(Object(u.a)({},i),{},{defaultStartTime:f.DateTime.fromISO(i.defaultStartTime)})}localStorage.setItem(A,JSON.stringify(e))}),[o]);var b=function(e){return function(t){var n={defaultStartTime:t.startTime,defaultGranularity:t.granularity,defaultDivisor:t.divisor,defaultTimerName:t.timerName,defaultAlgorithmStr:t.algorithmStr},a=Object(u.a)(Object(u.a)({},o),{},{timers:Object(u.a)(Object(u.a)({},o.timers),{},Object(l.a)({},e,n))});c(a)}},O=Math.max.apply(Math,Object(s.a)(Object.keys(o.timers).map((function(e){return parseInt(e)})).concat(-1)))+1,h=function(e){return function(){var t=Object(u.a)(Object(u.a)({},o),{},{timers:Object(u.a)({},o.timers)});delete t.timers[e],c(t)}},g=Object.entries(o.timers).map((function(e){var t=Object(m.a)(e,2),n=t[0],r=t[1];return Object(a.jsx)(R,Object(u.a)({onChange:b(n),onClose:h(n)},r),n)}));return Object(a.jsxs)("div",{children:[Object(a.jsx)(D.a,{}),Object(a.jsxs)(j.a,{utils:d.a,children:[g,Object(a.jsx)(T.a,{variant:"contained",color:"primary",onClick:function(){var e=t(),n=Object(u.a)(Object(u.a)({},o),{},{timers:Object(u.a)(Object(u.a)({},o.timers),{},Object(l.a)({},O,e))});c(n)},className:e.addTimerButton,children:"Add Timer"})]})]})},q=function(e){e&&e instanceof Function&&n.e(3).then(n.bind(null,169)).then((function(t){var n=t.getCLS,a=t.getFID,r=t.getFCP,i=t.getLCP,o=t.getTTFB;n(e),a(e),r(e),i(e),o(e)}))},z=Boolean("localhost"===window.location.hostname||"[::1]"===window.location.hostname||window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/));function V(e,t){navigator.serviceWorker.register(e).then((function(e){e.onupdatefound=function(){var n=e.installing;null!=n&&(n.onstatechange=function(){"installed"===n.state&&(navigator.serviceWorker.controller?(console.log("New content is available and will be used when all tabs for this page are closed. See https://cra.link/PWA."),t&&t.onUpdate&&t.onUpdate(e)):(console.log("Content is cached for offline use."),t&&t.onSuccess&&t.onSuccess(e)))})}})).catch((function(e){console.error("Error during service worker registration:",e)}))}n(108),n(109),n(110),n(111);c.a.render(Object(a.jsx)(i.a.StrictMode,{children:Object(a.jsx)(U,{})}),document.getElementById("root")),function(e){if("serviceWorker"in navigator){if(new URL("/optimal-timer",window.location.href).origin!==window.location.origin)return;window.addEventListener("load",(function(){var t="".concat("/optimal-timer","/service-worker.js");z?(!function(e,t){fetch(e,{headers:{"Service-Worker":"script"}}).then((function(n){var a=n.headers.get("content-type");404===n.status||null!=a&&-1===a.indexOf("javascript")?navigator.serviceWorker.ready.then((function(e){e.unregister().then((function(){window.location.reload()}))})):V(e,t)})).catch((function(){console.log("No internet connection found. App is running in offline mode.")}))}(t,e),navigator.serviceWorker.ready.then((function(){console.log("This web app is being served cache-first by a service worker. To learn more, visit https://cra.link/PWA")}))):V(t,e)}))}}(),q()}},[[112,1,2]]]);
//# sourceMappingURL=main.a6500c64.chunk.js.map