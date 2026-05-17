import Foundation

public protocol Sink {
    func emit(_ event: WireEvent, completion: @escaping (Result<Void, Error>) -> Void)
}

public final class HttpSink: Sink {
    private let ingestUrl: URL
    private let session: URLSession

    public init(ingestUrl: String, session: URLSession = .shared) {
        var url = ingestUrl
        while url.hasSuffix("/") { url.removeLast() }
        guard let parsed = URL(string: url) else {
            preconditionFailure("invalid ingest URL: \(ingestUrl)")
        }
        self.ingestUrl = parsed
        self.session = session
    }

    public func emit(_ event: WireEvent, completion: @escaping (Result<Void, Error>) -> Void) {
        var req = URLRequest(url: ingestUrl)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue(event.project_key, forHTTPHeaderField: "x-pixel-key")
        req.setValue("gg-pixel-swift/4.3.70", forHTTPHeaderField: "user-agent")
        let encoder = JSONEncoder()
        do {
            req.httpBody = try encoder.encode(event)
        } catch {
            completion(.failure(error))
            return
        }
        let task = session.dataTask(with: req) { _, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            guard let http = response as? HTTPURLResponse else {
                completion(.failure(NSError(domain: "GGPixel", code: -1)))
                return
            }
            if http.statusCode >= 400 {
                completion(.failure(NSError(
                    domain: "GGPixel",
                    code: http.statusCode,
                    userInfo: [NSLocalizedDescriptionKey: "ingest failed: \(http.statusCode)"]
                )))
            } else {
                completion(.success(()))
            }
        }
        task.resume()
    }

    /// Synchronous emit — blocks the caller. Used by the uncaught-exception
    /// handler so the fatal event lands before the process dies.
    public func emitSync(_ event: WireEvent) -> Result<Void, Error> {
        let semaphore = DispatchSemaphore(value: 0)
        var result: Result<Void, Error> = .failure(NSError(domain: "GGPixel", code: -1))
        emit(event) { r in
            result = r
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 3.0)
        return result
    }
}
