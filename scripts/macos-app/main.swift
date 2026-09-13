// MordomoOS native shell for macOS: starts the local service through the
// bundled CLI and shows the Command Centre in its own window (WKWebView).
// No Electron, no dependencies: compiled by scripts/package.mjs with swiftc.
//
//   MordomoOS [--url http://127.0.0.1:4777] [--snapshot out.png]
//
// --snapshot renders the page, writes a PNG and exits (used to verify a build
// without a person at the screen).
import Cocoa
import WebKit

let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
  var window: NSWindow!
  var webView: WKWebView!
  var status: NSTextField!
  var url: URL?
  var snapshotPath: String?
  var serviceStartedHere = false
  var lastLoadFailed = false

  // MARK: launch
  func applicationDidFinishLaunching(_ notification: Notification) {
    parseArguments()
    buildMenu()
    buildWindow()
    if url == nil { startService() } else { load() }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func parseArguments() {
    var args = CommandLine.arguments.dropFirst().makeIterator()
    while let a = args.next() {
      switch a {
      case "--url": if let v = args.next() { url = URL(string: v) }
      case "--snapshot": snapshotPath = args.next()
      default: break
      }
    }
  }

  // MARK: window + web view
  func buildWindow() {
    let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    let size = NSSize(width: min(1440, screen.width - 40), height: min(900, screen.height - 40))
    window = NSWindow(
      contentRect: NSRect(origin: .zero, size: size),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false)
    window.title = "MordomoOS"
    window.minSize = NSSize(width: 900, height: 600)
    window.setFrameAutosaveName("MordomoOS.main")
    window.center()
    window.delegate = self
    window.backgroundColor = NSColor(calibratedRed: 0.043, green: 0.039, blue: 0.031, alpha: 1)
    window.isReleasedWhenClosed = false

    let config = WKWebViewConfiguration()
    config.applicationNameForUserAgent = "MordomoOS/\(appVersion)"
    config.preferences.setValue(true, forKey: "developerExtrasEnabled")
    config.websiteDataStore = .default()
    webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
    webView.autoresizingMask = [.width, .height]
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.setValue(false, forKey: "drawsBackground")
    window.contentView!.addSubview(webView)

    status = NSTextField(labelWithString: "Starting your workspace…")
    status.textColor = NSColor(white: 0.95, alpha: 1)
    status.font = NSFont.systemFont(ofSize: 15)
    status.alignment = .center
    status.frame = NSRect(x: 0, y: window.contentView!.bounds.midY - 12, width: window.contentView!.bounds.width, height: 24)
    status.autoresizingMask = [.width, .minYMargin, .maxYMargin]
    window.contentView!.addSubview(status)

    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func buildMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem(); main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "About MordomoOS", action: #selector(about), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Hide MordomoOS", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Stop the background service and quit", action: #selector(stopAndQuit), keyEquivalent: "")
    appMenu.addItem(withTitle: "Quit MordomoOS (service keeps running)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu

    let editItem = NSMenuItem(); main.addItem(editItem)
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(.separator())
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit

    let viewItem = NSMenuItem(); main.addItem(viewItem)
    let view = NSMenu(title: "View")
    view.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
    view.addItem(withTitle: "Open in Browser", action: #selector(openInBrowser), keyEquivalent: "O")
    view.addItem(.separator())
    view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
    viewItem.submenu = view

    let windowItem = NSMenuItem(); main.addItem(windowItem)
    let win = NSMenu(title: "Window")
    win.addItem(withTitle: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
    win.addItem(withTitle: "Zoom", action: #selector(NSWindow.zoom(_:)), keyEquivalent: "")
    windowItem.submenu = win
    NSApp.windowsMenu = win
    NSApp.mainMenu = main
  }

  // MARK: service
  var cliPath: String { Bundle.main.resourcePath! + "/bin/mordomo" }

  /// `mordomo launch --no-browser` starts the service when nothing answers on
  /// the configured port and prints its URL; the window then loads it.
  func startService() {
    status.stringValue = "Starting your workspace…"
    let task = Process()
    task.executableURL = URL(fileURLWithPath: cliPath)
    task.arguments = ["launch", "--no-browser"]
    var env = ProcessInfo.processInfo.environment
    env["MORDOMO_SHELL"] = "macos/\(appVersion)"
    task.environment = env
    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = pipe
    task.terminationHandler = { [weak self] proc in
      let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
      DispatchQueue.main.async {
        guard let self = self else { return }
        if proc.terminationStatus == 0, let found = out.split(separator: " ").first(where: { $0.hasPrefix("http://") }) {
          self.url = URL(string: String(found).trimmingCharacters(in: .whitespacesAndNewlines))
          self.serviceStartedHere = true
          self.load()
        } else {
          self.fail("The local service did not start.\n\n\(out.trimmingCharacters(in: .whitespacesAndNewlines))")
        }
      }
    }
    do { try task.run() } catch {
      fail("Could not run the bundled CLI at \(cliPath): \(error.localizedDescription)")
    }
  }

  func load() {
    guard let url = url else { return }
    status.stringValue = "Opening \(url.absoluteString)…"
    webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20))
  }

  func fail(_ message: String) {
    status.stringValue = "MordomoOS could not start"
    let alert = NSAlert()
    alert.messageText = "MordomoOS could not start"
    alert.informativeText = message + "\n\nLogs: ~/Library/Application Support/MordomoOS/logs"
    alert.addButton(withTitle: "Try again")
    alert.addButton(withTitle: "Quit")
    if alert.runModal() == .alertFirstButtonReturn { url = nil; startService() } else { NSApp.terminate(nil) }
    if snapshotPath != nil { exit(2) }
  }

  // MARK: actions
  @objc func reload() { webView.reload() }
  @objc func openInBrowser() { if let u = url { NSWorkspace.shared.open(u) } }
  @objc func about() {
    let alert = NSAlert()
    alert.messageText = "MordomoOS \(appVersion)"
    alert.informativeText = "Local agentic OS over Claude Code, Cursor Agent and Codex.\nService: \(url?.absoluteString ?? "not running")"
    alert.runModal()
  }
  @objc func stopAndQuit() {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: cliPath)
    task.arguments = ["stop"]
    try? task.run()
    task.waitUntilExit()
    NSApp.terminate(nil)
  }

  // MARK: navigation
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    status.isHidden = true
    lastLoadFailed = false
    if let path = snapshotPath { snapshot(to: path) }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { retryLater(error) }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { retryLater(error) }
  /// The service may still be booting when the first request goes out: retry a few times before giving up.
  var retries = 0
  func retryLater(_ error: Error) {
    if (error as NSError).code == NSURLErrorCancelled { return }
    retries += 1
    if retries > 30 { fail("The Command Centre did not answer: \(error.localizedDescription)"); return }
    status.isHidden = false
    status.stringValue = "Waiting for the local service… (\(retries))"
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.load() }
  }
  /// Links that leave the local service open in the default browser; the app only shows its own pages.
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if let target = action.request.url, let base = url,
       action.navigationType == .linkActivated, target.host != base.host || target.port != base.port {
      NSWorkspace.shared.open(target)
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let target = action.request.url { NSWorkspace.shared.open(target) }
    return nil
  }
  /// The console's microphone button: the page is our own, so grant it.
  @available(macOS 12.0, *)
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(type == .microphone ? .grant : .deny)
  }
  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let alert = NSAlert(); alert.messageText = message; alert.runModal(); completionHandler()
  }
  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert(); alert.messageText = message
    alert.addButton(withTitle: "OK"); alert.addButton(withTitle: "Cancel")
    completionHandler(alert.runModal() == .alertFirstButtonReturn)
  }

  // MARK: snapshot (build verification)
  func snapshot(to path: String) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
      guard let self = self else { return }
      let config = WKSnapshotConfiguration()
      self.webView.takeSnapshot(with: config) { image, error in
        guard let image = image, let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else {
          FileHandle.standardError.write("snapshot failed: \(error?.localizedDescription ?? "no image")\n".data(using: .utf8)!)
          exit(3)
        }
        do { try png.write(to: URL(fileURLWithPath: path)); print("snapshot written to \(path)"); exit(0) }
        catch { FileHandle.standardError.write("cannot write \(path)\n".data(using: .utf8)!); exit(3) }
      }
    }
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
