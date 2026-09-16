// 基于 ssh2 的远程执行封装：支持密码或密钥登录，供部署脚本使用
// 为什么不直接用系统 ssh 命令：Windows 版 OpenSSH 无法从 stdin 读取密码，
// 而服务器账密是 algo+密码（见 prod/AGENTS.md 的账号说明），所以用库来实现。
import fs from 'node:fs'
import { Client } from 'ssh2'

export function connect ({ host, port = 22, user, password, keyPath }) {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    const cfg = {
      host, port, username: user,
      readyTimeout: 20000, keepaliveInterval: 15000, keepaliveCountMax: 4
    }
    if (password) {
      cfg.password = password
      cfg.tryKeyboard = true
    } else if (keyPath && fs.existsSync(keyPath)) {
      cfg.privateKey = fs.readFileSync(keyPath)
    } else {
      reject(new Error('既没有密码也没有可用私钥'))
      return
    }
    conn.on('ready', () => resolve(wrap(conn, { password })))
    conn.on('error', (e) => reject(e))
    conn.on('timeout', () => reject(new Error('SSH 连接超时')))
    conn.connect(cfg)
  })
}

function wrap (conn, { password }) {
  const run = (cmd, stdin) => new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err)
      let out = ''
      let errOut = ''
      stream.on('data', (d) => { out += d.toString('utf8') })
      stream.stderr.on('data', (d) => { errOut += d.toString('utf8') })
      stream.on('close', (code) => resolve({ code: code ?? 1, out, err: errOut }))
      stream.on('error', reject)
      if (stdin !== undefined) stream.end(stdin)
      else stream.end()
    })
  })

  return {
    // 普通执行
    async exec (script) {
      return run('bash -s', `${script}\n`)
    },
    // 提权执行：sudo 先吃掉 stdin 第一行密码，其余交给 bash -s
    async sudo (script) {
      if (password) return run(`sudo -S -p '' bash -s`, `${password}\n${script}\n`)
      // 密钥登录时 sudo 若要密码，需服务器对该账号免密 sudo
      return run(`sudo -n bash -s`, `${script}\n`)
    },
    // 以 root 身份跑可以免密执行的命令（sudo -n 失败时给明确提示）
    async asRoot (script) {
      const r = await this.sudo(script)
      if (r.code !== 0 && /sudo:|password is required|a terminal is required/i.test(r.err + r.out)) {
        const e = new Error('sudo 提权失败（该账号没有免密 sudo，或密码不对）')
        e.detail = (r.err + r.out).trim()
        throw e
      }
      return r
    },
    async upload (localPath, remotePath) {
      return new Promise((resolve, reject) => {
        conn.sftp((err, sftp) => {
          if (err) return reject(err)
          sftp.fastPut(localPath, remotePath, (e) => (e ? reject(e) : resolve()))
        })
      })
    },
    close () { try { conn.end() } catch {} }
  }
}
