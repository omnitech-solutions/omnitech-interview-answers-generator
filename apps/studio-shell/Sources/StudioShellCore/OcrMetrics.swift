import CoreGraphics
import Foundation

// [DOMAIN] Bounded evidence about how much of a frame the recognised text
// covers (decision D35). The server uses it, with the text itself, to decide
// whether the image adds anything beyond the text; the shell only measures.
// [STRATEGY] The union of the text boxes is approximated on a coarse grid
// (`OcrMetrics.gridSize` square): cheap, deterministic, no geometry library.
// A cell counts as covered when any box overlaps it, so thin text lines cover
// whole rows: the numbers describe "where text sits", not pixel area.
// [SAFETY] Numbers only: no text, no box positions leave this type.
public struct OcrMetrics: Equatable, Sendable {
    public static let gridSize = 32

    // Fraction of the frame (0...1) in cells touched by a text box.
    public let coverage: Double
    // Mean recognition confidence of the boxes, 0...1.
    public let meanConfidence: Double
    // Area fraction (0...1) of the largest axis-aligned rectangle of cells no
    // text box touches.
    public let largestGap: Double
    // Number of non-empty text boxes.
    public let boxes: Int

    public init(coverage: Double, meanConfidence: Double, largestGap: Double, boxes: Int) {
        self.coverage = coverage
        self.meanConfidence = meanConfidence
        self.largestGap = largestGap
        self.boxes = boxes
    }

    // The `metrics` object of an `ocr` block.
    public var wire: [String: Any] {
        ["coverage": coverage, "meanConfidence": meanConfidence, "largestGap": largestGap, "boxes": boxes]
    }

    // Boxes are normalised to the image (origin anywhere: only areas matter).
    // Non-finite or empty boxes are ignored; boxes are clamped to the frame.
    public static func measure(boxes observed: [(box: CGRect, confidence: Double)]) -> OcrMetrics {
        let n = gridSize
        var covered = [[Bool]](repeating: [Bool](repeating: false, count: n), count: n)
        var count = 0
        var confidenceSum = 0.0
        for item in observed {
            let box = item.box
            guard box.minX.isFinite, box.minY.isFinite, box.width.isFinite, box.height.isFinite,
                box.width > 0, box.height > 0
            else { continue }
            let x0 = min(max(box.minX, 0), 1), x1 = min(max(box.maxX, 0), 1)
            let y0 = min(max(box.minY, 0), 1), y1 = min(max(box.maxY, 0), 1)
            guard x1 > x0, y1 > y0 else { continue }
            count += 1
            confidenceSum += min(1, max(0, item.confidence))
            // Cells the box overlaps: first cell containing its low edge, last
            // cell containing its high edge (an edge on a cell line stays out).
            let cx0 = min(n - 1, Int(x0 * Double(n))), cx1 = min(n - 1, max(cx0, Int(ceil(x1 * Double(n))) - 1))
            let cy0 = min(n - 1, Int(y0 * Double(n))), cy1 = min(n - 1, max(cy0, Int(ceil(y1 * Double(n))) - 1))
            for y in cy0...cy1 { for x in cx0...cx1 { covered[y][x] = true } }
        }
        let cells = Double(n * n)
        let coveredCount = covered.reduce(0) { $0 + $1.filter { $0 }.count }
        return OcrMetrics(
            coverage: Double(coveredCount) / cells,
            meanConfidence: count == 0 ? 0 : confidenceSum / Double(count),
            largestGap: Double(largestEmptyRectangle(covered)) / cells,
            boxes: count)
    }

    // Largest rectangle of uncovered cells: the histogram method, one pass per
    // row with a monotonic stack (O(n^2)).
    static func largestEmptyRectangle(_ covered: [[Bool]]) -> Int {
        guard let width = covered.first?.count else { return 0 }
        var heights = [Int](repeating: 0, count: width)
        var best = 0
        for row in covered {
            for x in 0..<width { heights[x] = row[x] ? 0 : heights[x] + 1 }
            var stack: [Int] = []
            for x in 0...width {
                let h = x == width ? 0 : heights[x]
                while let top = stack.last, heights[top] >= h {
                    stack.removeLast()
                    let left = stack.last.map { $0 + 1 } ?? 0
                    best = max(best, heights[top] * (x - left))
                }
                stack.append(x)
            }
        }
        return best
    }
}
