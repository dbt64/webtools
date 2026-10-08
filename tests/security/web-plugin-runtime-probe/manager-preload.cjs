'use strict'
const { contextBridge } = require('electron')
contextBridge.exposeInMainWorld('desktop', Object.freeze({ managerPreloadSentinel: 'trusted-manager-preload' }))
