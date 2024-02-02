import { AppWindow, createMainWindow, createMenu, createTray } from './core/window'
import { app, ipcMain, session } from 'electron'
import is from 'electron-is'
import fixPath from 'fix-path'
import { release } from 'os'
import { getResourcesPath, getStaticPath } from './utils/mainfile'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { EventEmitter } from 'node:events'
import exception from './core/exception'
import ipcEvent from './core/ipcEvent'
import path from 'path'

type UserToken = {
  access_token: string;
  open_api_access_token: string;
  user_id: string;
  refresh: boolean
}

export default class launch extends EventEmitter {
  private userToken: UserToken = {
    access_token: '',
    open_api_access_token: '',
    user_id: '',
    refresh: false
  }

  constructor() {
    super()
    this.init()
  }

  init() {
    this.start()
    if (is.mas()) return
    const gotSingleLock = app.requestSingleInstanceLock()
    if (!gotSingleLock) {
      app.exit()
    } else {
      app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (commandLine && commandLine.join(' ').indexOf('exit') >= 0) {
          this.hasExitArgv(commandLine)
        } else if (AppWindow.mainWindow && AppWindow.mainWindow.isDestroyed() == false) {
          if (AppWindow.mainWindow.isMinimized()) {
            AppWindow.mainWindow.restore()
          }
          AppWindow.mainWindow.show()
          AppWindow.mainWindow.focus()
        }
      })
    }
  }

  start() {
    exception.handler()
    this.setInitArgv()
    this.loadUserData()
    this.handleEvents()
    this.handleAppReady()
  }

  setInitArgv() {
    fixPath()
    if (release().startsWith('6.1')) {
      app.disableHardwareAcceleration()
    }
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    process.env.DIST = path.join(__dirname, '../dist')
    process.env.VITE_PUBLIC = app.isPackaged
      ? process.env.DIST
      : path.join(process.env.DIST, '../public')

    app.commandLine.appendSwitch('no-sandbox')
    app.commandLine.appendSwitch('disable-web-security')
    app.commandLine.appendSwitch('disable-renderer-backgrounding')
    app.commandLine.appendSwitch('disable-site-isolation-trials')
    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors,SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure,BlockInsecurePrivateNetworkRequests')
    app.commandLine.appendSwitch('ignore-connections-limit', 'bj29.cn-beijing.data.alicloudccp.com,alicloudccp.com,api.aliyundrive.com,aliyundrive.com')
    app.commandLine.appendSwitch('ignore-certificate-errors')
    app.commandLine.appendSwitch('proxy-bypass-list', '<local>')
    app.commandLine.appendSwitch('wm-window-animations-disabled')
    app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')
    app.commandLine.appendSwitch('force_high_performance_gpu')

    app.name = 'aliyunxby'
    if (is.windows()) {
      app.setAppUserModelId('com.github.odomu')
    }
    this.hasExitArgv(process.argv)
  }

  hasExitArgv(args) {
    if (args && args.join(' ').indexOf('exit') >= 0) {
      app.exit()
    }
  }

  loadUserData() {
    const userData = getResourcesPath('userdir.config')
    try {
      if (existsSync(userData)) {
        const configData = readFileSync(userData, 'utf-8')
        if (configData) app.setPath('userData', configData)
      }
    } catch {
    }
  }

  handleEvents() {
    ipcEvent.handleEvents()
    this.handleUserToken()
    this.handleAppActivate()
    this.handleAppWillQuit()
    this.handleAppWindowAllClosed()
  }

  handleAppReady() {
    app
      .whenReady()
      .then(() => {
        try {
          const localVersion = getResourcesPath('localVersion')
          if (localVersion && existsSync(localVersion)) {
            const version = readFileSync(localVersion, 'utf-8')
            if (app.getVersion() > version) {
              writeFileSync(localVersion, app.getVersion(), 'utf-8')
            }
          } else {
            writeFileSync(localVersion, app.getVersion(), 'utf-8')
          }
        } catch (err) {
        }
        session.defaultSession.webRequest.onBeforeSendHeaders((details, cb) => {
          const shouldGieeReferer = details.url.indexOf('gitee.com') > 0
          const shouldBiliBili = details.url.indexOf('bilibili.com') > 0
          const shouldAliOrigin = details.url.indexOf('.aliyundrive.com') > 0 || details.url.indexOf('.alipan.com') > 0
          const shouldAliReferer = !shouldBiliBili && !shouldGieeReferer && (!details.referrer || details.referrer.trim() === '' || /(\/localhost:)|(^file:\/\/)|(\/127.0.0.1:)/.exec(details.referrer) !== null)
          const shouldToken = details.url.includes('aliyundrive') && details.url.includes('download')
          const shouldOpenApiToken = details.url.includes('adrive/v1.0')

          cb({
            cancel: false,
            requestHeaders: {
              ...details.requestHeaders,
              ...(shouldGieeReferer && {
                Referer: 'https://gitee.com/'
              }),
              ...(shouldAliOrigin && {
                Origin: 'https://www.aliyundrive.com'
              }),
              ...(shouldAliReferer && {
                Referer: 'https://www.aliyundrive.com/'
              }),
              ...(shouldBiliBili && {
                Referer: 'https://www.bilibili.com/',
                Cookie: 'buvid_fp=4e5ab1b80f684b94efbf0d2f4721913e;buvid3=0679D9AB-1548-ED1E-B283-E0114517315E63379infoc;buvid4=990C4544-0943-1FBF-F13C-4C42A4EA97AA63379-024020214-83%2BAINcbQP917Ye0PjtrCg%3D%3D;'
              }),
              ...(shouldToken && {
                Authorization: this.userToken.access_token
              }),
              ...(shouldOpenApiToken && {
                Authorization: this.userToken.open_api_access_token
              }),
              ...(shouldToken && {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
                'X-Canary': 'client=web,app=adrive,version=v4.9.0'
              }),
              'Accept-Language': 'zh-CN,zh;q=0.9'
            }
          })
        })
        session.defaultSession.loadExtension(getStaticPath('crx'), { allowFileAccess: true }).then(() => {
          createMainWindow()
          createMenu()
          createTray()
        })
      })
      .catch((err: any) => {
        console.log(err)
      })
  }

  handleUserToken() {
    ipcMain.on('WebUserToken', (event, data) => {
      if (data.login) {
        this.userToken = data
      } else if (this.userToken.user_id == data.user_id) {
        this.userToken = data
        // ShowError('WebUserToken', 'update' + data.name)
      } else {
        // ShowError('WebUserToken', 'nothing' + data.name)
      }
    })
  }

  handleAppActivate() {
    app.on('activate', () => {
      if (!AppWindow.mainWindow || AppWindow.mainWindow.isDestroyed()) createMainWindow()
      else {
        if (AppWindow.mainWindow.isMinimized()) AppWindow.mainWindow.restore()
        AppWindow.mainWindow.show()
        AppWindow.mainWindow.focus()
      }
    })
  }

  handleAppWillQuit() {
    app.on('will-quit', () => {
      try {
        if (AppWindow.appTray) {
          AppWindow.appTray.destroy()
          AppWindow.appTray = undefined
        }
      } catch {

      }
    })
  }

  handleAppWindowAllClosed() {
    app.on('window-all-closed', () => {
      if (is.macOS()) {
        AppWindow.appTray?.destroy()
      } else {
        app.quit() // 未测试应该使用哪一个
      }
    })
  }
}