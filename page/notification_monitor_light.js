import { NotificationMonitorV2 } from "../scripts/notifications-monitor/core/NotificationMonitorV2.js";
const NotifMon = new NotificationMonitorV2();
NotifMon.initialize();

import { isFirefox, isChromium, isSafari } from "/scripts/core/utils/BrowserDetection.js";

//If browser is firefox, load icon_firefox.css
if (isFirefox()) {
	document.head.innerHTML += `<link rel="stylesheet" type="text/css" href="../resource/css/icon_firefox.css" />`;
}
//If the browser is chrome, load icon_chrome.css
if (isChromium()) {
	document.head.innerHTML += `<link rel="stylesheet" type="text/css" href="../resource/css/icon_chrome.css" />`;
}
if (isSafari()) {
	document.head.innerHTML += `<link rel="stylesheet" type="text/css" href="../resource/css/icon_ios.css" />`;
}
