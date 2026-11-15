import { createVideoCommandHandler } from './video-store.js';

const handleVideos = createVideoCommandHandler(chrome.storage.local);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'video-command' || sender.id !== chrome.runtime.id) return;
  handleVideos(message.command).then(respond, error => respond({ error: error.message }));
  return true;
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
