import CaptureCore
import Foundation

// [SAFETY] The one network edge. An ephemeral session keeps nothing on disk:
// no cookies, no cache, no stored credentials; every request carries its own
// Authorization header from Core's Endpoint builder. Nothing here logs a URL,
// header, body or response.
public final class URLSessionTransport: Transport {
    private let session: URLSession

    public init(timeoutSeconds: TimeInterval = 15) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        configuration.timeoutIntervalForRequest = timeoutSeconds
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
    }

    public func send(_ request: OutgoingRequest) async -> TransportResult {
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = "POST"
        urlRequest.httpBody = request.body
        for (name, value) in request.headers { urlRequest.setValue(value, forHTTPHeaderField: name) }
        do {
            let (data, response) = try await session.data(for: urlRequest)
            guard let http = response as? HTTPURLResponse else { return .unreachable }
            let retryAfter = http.value(forHTTPHeaderField: "Retry-After").flatMap { Double($0) }
            return .response(status: http.statusCode, body: data, retryAfterSeconds: retryAfter)
        } catch {
            return .unreachable
        }
    }
}
