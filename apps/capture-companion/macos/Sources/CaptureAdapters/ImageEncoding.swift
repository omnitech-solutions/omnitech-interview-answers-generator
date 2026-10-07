import CaptureCore
import CoreGraphics
import Foundation
import ImageIO

// [DOMAIN] Pixel work for screenshots: a tiny luma grid for Core's change
// policy, and downscale plus JPEG compression to fit under the contract's byte
// cap. Frames live in memory only; nothing is written to disk.
enum ImageEncoder {
    struct LumaFrame: PerceptualFrame {
        let lumaGrid: [UInt8]
    }

    // Draws the image into a 9x8 grayscale bitmap (row-major).
    static func lumaFrame(_ image: CGImage) -> LumaFrame? {
        let columns = PerceptualHash.gridColumns
        let rows = PerceptualHash.gridRows
        var pixels = [UInt8](repeating: 0, count: columns * rows)
        let drawn = pixels.withUnsafeMutableBytes { raw -> Bool in
            guard
                let context = CGContext(
                    data: raw.baseAddress, width: columns, height: rows, bitsPerComponent: 8,
                    bytesPerRow: columns, space: CGColorSpaceCreateDeviceGray(),
                    bitmapInfo: CGImageAlphaInfo.none.rawValue)
            else { return false }
            context.interpolationQuality = .medium
            context.draw(image, in: CGRect(x: 0, y: 0, width: columns, height: rows))
            return true
        }
        return drawn ? LumaFrame(lumaGrid: pixels) : nil
    }

    // [STRATEGY] Try the quality ladder at the current size, then halve the
    // width and try again: the cap is the companion's to meet, not Studio's.
    static func jpeg(_ image: CGImage, maxBytes: Int, startWidth: Int = 1600) -> Data? {
        var width = min(image.width, startWidth)
        for _ in 0..<4 {
            guard let scaled = scale(image, toWidth: width) else { return nil }
            for quality in [0.7, 0.5, 0.35, 0.25] {
                if let data = encode(scaled, quality: quality), data.count <= maxBytes { return data }
            }
            width /= 2
            if width < 200 { return nil }
        }
        return nil
    }

    private static func scale(_ image: CGImage, toWidth width: Int) -> CGImage? {
        if image.width == width { return image }
        let height = max(1, image.height * width / image.width)
        guard
            let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return nil }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return context.makeImage()
    }

    private static func encode(_ image: CGImage, quality: Double) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, "public.jpeg" as CFString, 1, nil) else {
            return nil
        }
        CGImageDestinationAddImage(
            destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }
}
