import Foundation

// A live connection to the server that reconnects by itself, for a room or the home list. A
// text ping every 25 s keeps it open (the server answers without waking up) and tells the
// server we are still here; 70 s without hearing anything counts as lost and a new one is
// made. `onDown` says whether the server cannot be reached: an attempt that never opened,
// until one does.
@MainActor
public final class LiveConnection<Message> {
    private let url: URL
    private let hello: () -> String?
    private let onMessage: (Message) -> Void
    private let decode: (Data) throws -> Message
    private let onDown: (Bool) -> Void
    private let session = URLSession(configuration: .default)
    private var task: URLSessionWebSocketTask?
    private var loop: Task<Void, Never>?
    private var heardAt = Date()

    init(url: URL, hello: @escaping () -> String?, decode: @escaping (Data) throws -> Message, onDown: @escaping (Bool) -> Void = { _ in }, onMessage: @escaping (Message) -> Void) {
        self.url = url
        self.hello = hello
        self.decode = decode
        self.onMessage = onMessage
        self.onDown = onDown
    }

    func open() {
        guard loop == nil else { return }
        loop = Task { [weak self] in
            var retry: UInt64 = 1
            while !Task.isCancelled {
                guard let self else { return }
                let heard = await self.runOnce()
                if Task.isCancelled { return }
                if heard { retry = 1 } else { self.onDown(true) }
                try? await Task.sleep(nanoseconds: retry * 1_000_000_000)
                retry = min(retry * 2, 30)
            }
        }
    }

    // A normal close: the server takes it as this device going away.
    func close() {
        loop?.cancel()
        loop = nil
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
    }

    func send(_ text: String) {
        task?.send(.string(text)) { _ in }
    }

    // One connection, until it ends; true when anything was heard on it.
    private func runOnce() async -> Bool {
        let t = session.webSocketTask(with: url)
        task = t
        t.resume()
        if let hello = hello() { try? await t.send(.string(hello)) }
        heardAt = Date()
        var heard = false
        let pinger = Task { [weak self, weak t] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 25_000_000_000)
                guard let self, let t, !Task.isCancelled else { return }
                if Date().timeIntervalSince(self.heardAt) > 70 { t.cancel(with: .goingAway, reason: nil); return }
                try? await t.send(.string("ping"))
            }
        }
        defer { pinger.cancel() }
        while !Task.isCancelled {
            guard let message = try? await t.receive() else { break }
            heardAt = Date()
            if !heard { heard = true; onDown(false) }
            guard case let .string(text) = message, text != "pong", let m = try? decode(Data(text.utf8)) else { continue }
            onMessage(m)
        }
        if task === t { task = nil }
        return heard
    }
}
