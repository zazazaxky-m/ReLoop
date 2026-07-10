import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../theme/colors.dart';

/// Full-screen camera scanner that returns a trash-bag QR code string.
///
/// Accepts either a raw `BAG-XXXXXXXXXXXX` code or a URL/text that contains it.
Future<String?> scanBagQrCode(BuildContext context) {
  return Navigator.of(context, rootNavigator: true).push<String>(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => const BagQrScannerScreen(),
    ),
  );
}

class BagQrScannerScreen extends StatefulWidget {
  const BagQrScannerScreen({super.key});

  @override
  State<BagQrScannerScreen> createState() => _BagQrScannerScreenState();
}

class _BagQrScannerScreenState extends State<BagQrScannerScreen>
    with WidgetsBindingObserver {
  late final MobileScannerController _controller;
  bool _handled = false;
  bool _torchOn = false;
  final _manualCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _controller = MobileScannerController(
      detectionSpeed: DetectionSpeed.normal,
      facing: CameraFacing.back,
    );
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _manualCtrl.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!_controller.value.hasCameraPermission) return;
    switch (state) {
      case AppLifecycleState.resumed:
        unawaited(_controller.start());
      case AppLifecycleState.inactive:
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
      case AppLifecycleState.detached:
        unawaited(_controller.stop());
    }
  }

  String? _extractBagCode(String raw) {
    final trimmed = raw.trim();
    final bagMatch = RegExp(r'BAG-[A-F0-9]{12}', caseSensitive: false)
        .firstMatch(trimmed);
    if (bagMatch != null) {
      return bagMatch.group(0)!.toUpperCase();
    }
    // Allow pasting a bare code that already looks like BAG-...
    if (RegExp(r'^BAG-[A-Za-z0-9-]{6,}$').hasMatch(trimmed)) {
      return trimmed.toUpperCase();
    }
    return null;
  }

  void _onDetect(BarcodeCapture capture) {
    if (_handled) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null || raw.isEmpty) return;

    final code = _extractBagCode(raw);
    if (code == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('QR bukan kode trash bag. Cari kode BAG-...'),
          backgroundColor: ReLoopColors.danger,
        ),
      );
      return;
    }

    _handled = true;
    HapticFeedback.mediumImpact();
    unawaited(_controller.stop());
    if (mounted) Navigator.of(context).pop(code);
  }

  void _submitManual() {
    final code = _extractBagCode(_manualCtrl.text);
    if (code == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Format kode tidak valid. Contoh: BAG-A1B2C3D4E5F6'),
          backgroundColor: ReLoopColors.danger,
        ),
      );
      return;
    }
    _handled = true;
    Navigator.of(context).pop(code);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close, color: Colors.white),
                  ),
                  const Expanded(
                    child: Text(
                      'Scan QR Kantong',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        fontSize: 16,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: _torchOn ? 'Matikan flash' : 'Nyalakan flash',
                    onPressed: () async {
                      await _controller.toggleTorch();
                      setState(() => _torchOn = !_torchOn);
                    },
                    icon: Icon(
                      _torchOn ? Icons.flash_on : Icons.flash_off,
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(20),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    MobileScanner(
                      controller: _controller,
                      onDetect: _onDetect,
                      errorBuilder: (context, error) {
                        final denied =
                            error.errorCode == MobileScannerErrorCode.permissionDenied;
                        return ColoredBox(
                          color: const Color(0xFF111827),
                          child: Center(
                            child: Padding(
                              padding: const EdgeInsets.all(24),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    denied
                                        ? Icons.no_photography_outlined
                                        : Icons.videocam_off_outlined,
                                    size: 48,
                                    color: Colors.white70,
                                  ),
                                  const SizedBox(height: 12),
                                  Text(
                                    denied
                                        ? 'Izin kamera dibutuhkan untuk scan QR kantong.'
                                        : 'Kamera tidak tersedia. Masukkan kode manual di bawah.',
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(color: Colors.white70),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                    IgnorePointer(
                      child: CustomPaint(
                        painter: _BagScannerOverlayPainter(),
                      ),
                    ),
                    const Positioned(
                      left: 24,
                      right: 24,
                      bottom: 24,
                      child: Text(
                        'Arahkan kamera ke stiker QR kantong\n(kode dimulai dengan BAG-)',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                          shadows: [
                            Shadow(blurRadius: 8, color: Colors.black54),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 20),
              color: const Color(0xFF0B1220),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'Atau masukkan kode manual',
                    style: TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _manualCtrl,
                          style: const TextStyle(
                            color: Colors.white,
                            fontFamily: 'monospace',
                            fontWeight: FontWeight.w600,
                          ),
                          textCapitalization: TextCapitalization.characters,
                          decoration: InputDecoration(
                            hintText: 'BAG-A1B2C3D4E5F6',
                            hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.35)),
                            filled: true,
                            fillColor: Colors.white.withValues(alpha: 0.08),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide.none,
                            ),
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 12,
                            ),
                          ),
                          onSubmitted: (_) => _submitManual(),
                        ),
                      ),
                      const SizedBox(width: 10),
                      FilledButton(
                        onPressed: _submitManual,
                        style: FilledButton.styleFrom(
                          backgroundColor: ReLoopColors.brand500,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 18,
                            vertical: 14,
                          ),
                        ),
                        child: const Text('Pakai'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BagScannerOverlayPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    const reticle = 240.0;
    final left = (size.width - reticle) / 2;
    final top = (size.height - reticle) / 2;
    final rect = Rect.fromLTWH(left, top, reticle, reticle);

    final overlay = Path()
      ..addRect(Offset.zero & size)
      ..addRRect(RRect.fromRectAndRadius(rect, const Radius.circular(20)))
      ..fillType = PathFillType.evenOdd;
    canvas.drawPath(
      overlay,
      Paint()..color = Colors.black.withValues(alpha: 0.55),
    );

    final border = Paint()
      ..color = ReLoopColors.brand400
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3;
    canvas.drawRRect(
      RRect.fromRectAndRadius(rect, const Radius.circular(20)),
      border,
    );

    // Corner accents
    final corner = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round;
    const len = 28.0;
    // TL
    canvas.drawLine(Offset(left, top + len), Offset(left, top), corner);
    canvas.drawLine(Offset(left, top), Offset(left + len, top), corner);
    // TR
    canvas.drawLine(Offset(left + reticle - len, top), Offset(left + reticle, top), corner);
    canvas.drawLine(Offset(left + reticle, top), Offset(left + reticle, top + len), corner);
    // BL
    canvas.drawLine(Offset(left, top + reticle - len), Offset(left, top + reticle), corner);
    canvas.drawLine(Offset(left, top + reticle), Offset(left + len, top + reticle), corner);
    // BR
    canvas.drawLine(
      Offset(left + reticle - len, top + reticle),
      Offset(left + reticle, top + reticle),
      corner,
    );
    canvas.drawLine(
      Offset(left + reticle, top + reticle - len),
      Offset(left + reticle, top + reticle),
      corner,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
