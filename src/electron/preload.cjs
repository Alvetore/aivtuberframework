const { contextBridge, ipcRenderer } = require('electron');

const api = {
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    userData: () => ipcRenderer.invoke('app:userData'),
  },
  twitch: {
    login: () => ipcRenderer.invoke('twitch:login'),
  },
  avatar: {
    openWindow: () => ipcRenderer.invoke('avatar:open-window'),
    closeWindow: () => ipcRenderer.invoke('avatar:close-window'),
    isOpen: () => ipcRenderer.invoke('avatar:is-open'),
    selectModel: () => ipcRenderer.invoke('avatar:select-model'),
  },
};

contextBridge.exposeInMainWorld('appInfo', api.app);
contextBridge.exposeInMainWorld('twitchAuth', api.twitch);
contextBridge.exposeInMainWorld('avatarControl', api.avatar);
