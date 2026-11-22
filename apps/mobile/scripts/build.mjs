import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Builds the shared React UI for the WebView, syncs it into the Capacitor
 * Android project, and (with --assemble) produces a sideloadable debug APK.
 *
 * The server address is baked into the bundle because the app has no discovery
 * screen. Override it with PM_API_URL when the laptop's LAN address changes:
 *   PM_API_URL=http://192.168.1.20:8787 npm run apk -w @pm/mobile
 */

const mobileDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootDir = resolve(mobileDir, '..', '..')
const uiDist = join(rootDir, 'packages', 'ui', 'dist')
const wwwDir = join(mobileDir, 'www')
const androidDir = join(mobileDir, 'android')
const assemble = process.argv.includes('--assemble')

function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        return entry.address
      }
    }
  }
  return null
}

const address = lanAddress()
const apiUrl =
  process.env.PM_API_URL?.replace(/\/$/, '') ??
  process.env.VITE_API_URL?.replace(/\/$/, '') ??
  (address ? `http://${address}:8787` : 'http://localhost:8787')

if (!/^https?:\/\//.test(apiUrl)) {
  throw new Error(`Server address must start with http:// or https:// (got ${apiUrl})`)
}

console.log(`\n▸ Server address: ${apiUrl}`)
if (!process.env.PM_API_URL) {
  console.log('  (baked at build time — set PM_API_URL to change it)')
}

console.log('▸ Building the shared UI…')
execSync('npm run build:ui', {
  cwd: rootDir,
  stdio: 'inherit',
  env: { ...process.env, VITE_API_URL: apiUrl },
})

console.log('▸ Copying the web bundle into the Android shell…')
rmSync(wwwDir, { recursive: true, force: true })
cpSync(uiDist, wwwDir, { recursive: true })

if (!existsSync(androidDir)) {
  console.log('▸ Generating the Android project (first run only)…')
  execSync('npx cap add android', { cwd: mobileDir, stdio: 'inherit' })
}

console.log('▸ Syncing Capacitor…')
execSync('npx cap sync android', { cwd: mobileDir, stdio: 'inherit' })

if (!assemble) {
  console.log('\n✓ Web bundle synced. Run `npm run apk -w @pm/mobile` to assemble the APK.\n')
  process.exit(0)
}

// Plain-HTTP LAN server: the WebView may only reach it with cleartext allowed.
const manifestPath = join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml')
const manifest = readFileSync(manifestPath, 'utf8')
if (!manifest.includes('android:usesCleartextTraffic="true"')) {
  writeFileSync(
    manifestPath,
    manifest.replace('<application', '<application\n        android:usesCleartextTraffic="true"'),
  )
}

const sdkDir = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? 'C:\\Android'
if (!existsSync(sdkDir)) {
  throw new Error(
    `Android SDK not found at ${sdkDir}. Set ANDROID_HOME or install the SDK, then rerun.`,
  )
}
const escapedSdk = sdkDir.replace(/\\/g, '/').replace(':', '\\:')
writeFileSync(join(androidDir, 'local.properties'), `sdk.dir=${escapedSdk}\n`)

// The machine's global Gradle home is not writable here; keep the daemon, wrapper
// download and dependency cache inside the app instead.
const gradleHome = join(mobileDir, '.gradle-user-home')
mkdirSync(gradleHome, { recursive: true })

console.log('▸ Assembling the debug APK (first run downloads Gradle and dependencies)…')
const gradlew = join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')
execSync(`"${gradlew}" assembleDebug`, {
  cwd: androidDir,
  stdio: 'inherit',
  env: { ...process.env, GRADLE_USER_HOME: gradleHome },
})

const apkSource = join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
const releaseDir = join(mobileDir, 'release')
mkdirSync(releaseDir, { recursive: true })
const apkTarget = join(releaseDir, 'personal-messenger-debug.apk')
cpSync(apkSource, apkTarget)

console.log(`\n✓ APK ready: ${apkTarget}`)
console.log(`  Install it with: adb install -r "${apkTarget}"\n`)
