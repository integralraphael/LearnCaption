import Foundation
import ScreenCaptureKit
import AVFoundation

// Output format: 16kHz mono PCM float32, little-endian
// Each chunk: 4-byte little-endian uint32 byte-count + raw float32 samples

let TARGET_SAMPLE_RATE: Double = 16000
let CHUNK_SAMPLES = 1600 // 100ms chunks at 16kHz

class AudioCaptureSession: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private var micEngine: AVAudioEngine?
    private var outputBuffer = [Float]()
    private let queue = DispatchQueue(label: "audio.capture", qos: .userInteractive)

    func start() async throws {
        // 1. Microphone via AVAudioEngine
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        // Install tap using the input's native format, then resample
        let nativeFormat = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: nativeFormat) { [weak self] buf, _ in
            guard let self else { return }
            self.appendPCMBuffer(buf, sourceRate: nativeFormat.sampleRate)
        }
        try engine.start()
        self.micEngine = engine

        // 2. System audio via ScreenCaptureKit
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            fputs("audio-capture: no display found\n", stderr)
            return
        }
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = Int(TARGET_SAMPLE_RATE)
        config.channelCount = 1

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try await stream.startCapture()
        self.stream = stream

        fputs("audio-capture: started (mic + system audio)\n", stderr)
    }

    // MARK: - SCStreamOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        appendCMSampleBuffer(sampleBuffer)
    }

    // MARK: - SCStreamDelegate

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("audio-capture: stream stopped: \(error)\n", stderr)
    }

    // MARK: - Private

    private func appendPCMBuffer(_ buffer: AVAudioPCMBuffer, sourceRate: Double) {
        guard let channelData = buffer.floatChannelData?[0] else { return }
        let count = Int(buffer.frameLength)
        let samples = resample(Array(UnsafeBufferPointer(start: channelData, count: count)),
                               from: sourceRate, to: TARGET_SAMPLE_RATE)
        queue.async { self.enqueue(samples) }
    }

    private func appendCMSampleBuffer(_ sampleBuffer: CMSampleBuffer) {
        guard let blockBuf = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        var length = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(blockBuf, atOffset: 0, lengthAtOffsetOut: nil,
                                                 totalLengthOut: &length, dataPointerOut: &dataPointer)
        guard status == noErr, let ptr = dataPointer else { return }
        let floats = UnsafeBufferPointer(
            start: UnsafeRawPointer(ptr).assumingMemoryBound(to: Float.self),
            count: length / MemoryLayout<Float>.size)
        // ScreenCaptureKit already delivers at TARGET_SAMPLE_RATE (configured above)
        enqueue(Array(floats))
    }

    /// Simple linear interpolation resample
    private func resample(_ samples: [Float], from src: Double, to dst: Double) -> [Float] {
        guard src != dst, !samples.isEmpty else { return samples }
        let ratio = src / dst
        var result = [Float]()
        var pos: Double = 0
        while pos < Double(samples.count - 1) {
            let i = Int(pos)
            let frac = Float(pos - Double(i))
            result.append(samples[i] * (1 - frac) + samples[i + 1] * frac)
            pos += ratio
        }
        return result
    }

    private func enqueue(_ samples: [Float]) {
        outputBuffer.append(contentsOf: samples)
        while outputBuffer.count >= CHUNK_SAMPLES {
            let chunk = Array(outputBuffer.prefix(CHUNK_SAMPLES))
            outputBuffer.removeFirst(CHUNK_SAMPLES)
            writeChunk(chunk)
        }
    }

    private func writeChunk(_ samples: [Float]) {
        let byteCount = UInt32(samples.count * MemoryLayout<Float>.size)
        var le = byteCount.littleEndian
        withUnsafeBytes(of: &le) { FileHandle.standardOutput.write(Data($0)) }
        samples.withUnsafeBytes { FileHandle.standardOutput.write(Data($0)) }
    }
}

// Entry point
let session = AudioCaptureSession()
Task {
    do {
        try await session.start()
    } catch {
        fputs("audio-capture: fatal: \(error)\n", stderr)
        exit(1)
    }
}
RunLoop.main.run()
