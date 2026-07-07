import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../shared/format.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../theme/colors.dart';
import '../../theme/dimens.dart';

const _terminalSessionStatuses = {'COMPLETED', 'CANCELLED', 'EXPIRED'};
const double _reticleSize = 260;

class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen>
    with WidgetsBindingObserver, SingleTickerProviderStateMixin {
  late final MobileScannerController _controller;
  late final AnimationController _scanLineController;

  bool _isScanning = true;
  bool _isProcessing = false;
  bool _finishing = false;
  ScanResult? _scanResult;
  DepositSession? _liveSession;
  Timer? _pollTimer;
  String? _error;
  String? _lastScannedToken;

  @override
  void initState() {
    super.initState();
    _controller = MobileScannerController();
    WidgetsBinding.instance.addObserver(this);
    _scanLineController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    _scanLineController.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // The MobileScanner widget delegates lifecycle handling to us because a
    // controller is passed in. Only touch the camera while the scanner view is
    // actually on screen and the permission has been granted.
    if (_scanResult != null || !_controller.value.hasCameraPermission) {
      return;
    }

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

  Future<void> _restartCamera() async {
    try {
      await _controller.stop();
    } catch (_) {}
    try {
      await _controller.start();
    } catch (_) {}
  }

  void _onDetect(BarcodeCapture capture) {
    if (!_isScanning || _isProcessing) return;

    final barcode = capture.barcodes.firstOrNull;
    if (barcode == null || barcode.rawValue == null) return;

    final raw = barcode.rawValue!;
    if (raw == _lastScannedToken) return;

    _lastScannedToken = raw;
    _handleQrCode(raw);
  }

  Future<void> _handleQrCode(String qrData) async {
    setState(() {
      _isScanning = false;
      _isProcessing = true;
      _error = null;
    });

    try {
      Uri uri;
      try {
        uri = Uri.parse(qrData);
      } catch (_) {
        _failScan('QR code tidak valid');
        return;
      }

      final segments = uri.pathSegments;
      String? machineCode;
      String? token;

      // Handle both: /scan?machine=XXX&token=YYY and /machine/XXX/display
      if (uri.path.contains('scan')) {
        machineCode = uri.queryParameters['machine'] ?? uri.queryParameters['m'];
        token = uri.queryParameters['token'] ?? uri.queryParameters['t'];
      } else if (segments.length >= 3 && segments[0] == 'machine') {
        machineCode = segments[1];
        token = uri.queryParameters['token'];
      }

      machineCode ??= qrData.trim();
      token ??= '';

      if (machineCode.isEmpty) {
        _failScan('QR tidak mengandung kode mesin');
        return;
      }

      final api = context.read<ApiClient>();
      final response = await api.post('/api/scan', data: {
        'machineCode': machineCode,
        'token': token,
      });

      HapticFeedback.heavyImpact();

      final data = response.data as Map<String, dynamic>;
      final result = ScanResult.fromJson(data);
      setState(() {
        _scanResult = result;
        _liveSession = result.session;
        _isProcessing = false;
      });
      _startPolling(result.session.id);
    } on Exception catch (e) {
      String msg = 'Gagal memproses QR';
      HapticFeedback.vibrate();
      if (e is DioException) {
        final errData = e.response?.data;
        if (errData is Map) {
          msg = errData['error'] as String? ?? msg;
        }
      }
      _failScan(msg);
    }
  }

  /// Surfaces an error without silently re-enabling instant re-scanning, so a
  /// failing code cannot loop. The user resumes explicitly via "Scan lagi".
  void _failScan(String message) {
    setState(() {
      _error = message;
      _isProcessing = false;
      _isScanning = false;
    });
  }

  void _resumeScanning() {
    setState(() {
      _error = null;
      _lastScannedToken = null;
      _isScanning = true;
      _isProcessing = false;
    });
  }

  Future<void> _showManualEntryDialog() async {
    final textController = TextEditingController();
    try {
      final value = await showDialog<String>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            backgroundColor: dialogContext.reloopSurface,
            shape: const RoundedRectangleBorder(borderRadius: ReLoopRadius.brLg),
            title: Text(
              'Masukkan kode manual',
              style: TextStyle(
                color: dialogContext.reloopForeground,
                fontSize: 16,
                fontWeight: FontWeight.w700,
              ),
            ),
            content: TextField(
              controller: textController,
              autofocus: true,
              textInputAction: TextInputAction.done,
              onSubmitted: (v) => Navigator.of(dialogContext).pop(v),
              style: TextStyle(color: dialogContext.reloopForeground),
              decoration: InputDecoration(
                hintText: 'Kode mesin atau URL QR',
                hintStyle: TextStyle(color: dialogContext.reloopMutedSoft),
                enabledBorder: OutlineInputBorder(
                  borderRadius: ReLoopRadius.brSm,
                  borderSide: BorderSide(color: dialogContext.reloopBorder),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: ReLoopRadius.brSm,
                  borderSide: const BorderSide(color: ReLoopColors.brand500),
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: Text(
                  'Batal',
                  style: TextStyle(color: dialogContext.reloopMuted),
                ),
              ),
              TextButton(
                onPressed: () =>
                    Navigator.of(dialogContext).pop(textController.text),
                child: const Text(
                  'Lanjut',
                  style: TextStyle(color: ReLoopColors.brand600),
                ),
              ),
            ],
          );
        },
      );

      if (!mounted) return;
      final trimmed = value?.trim() ?? '';
      if (trimmed.isEmpty) return;

      _lastScannedToken = trimmed;
      await _handleQrCode(trimmed);
    } finally {
      textController.dispose();
    }
  }

  /// Polls the deposit session every few seconds so the user sees items,
  /// weight, and reward land live instead of only the snapshot from the
  /// moment they scanned the QR code.
  void _startPolling(String sessionId) {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(
      const Duration(seconds: 2),
      (_) => _pollSession(sessionId),
    );
  }

  Future<void> _pollSession(String sessionId) async {
    if (!mounted) return;
    try {
      final api = context.read<ApiClient>();
      final response = await api.get('/api/sessions/$sessionId');
      final data = response.data as Map<String, dynamic>;
      final session = DepositSession.fromJson(data['session'] as Map<String, dynamic>);
      if (!mounted) return;
      setState(() => _liveSession = session);
      if (_terminalSessionStatuses.contains(session.status)) {
        _pollTimer?.cancel();
      }
    } catch (_) {
      // Transient network hiccup: keep showing the last known state and
      // retry on the next tick instead of surfacing a disruptive error.
    }
  }

  Future<void> _finishSession() async {
    final sessionId = _scanResult?.session.id;
    if (sessionId == null || _finishing) return;
    setState(() => _finishing = true);
    try {
      final api = context.read<ApiClient>();
      await api.patch('/api/sessions/$sessionId', data: {'action': 'finish'});
      HapticFeedback.mediumImpact();
    } catch (_) {
      // Best-effort: if this fails (e.g. offline), still let the user leave
      // the screen — the session will simply expire server-side.
    } finally {
      if (mounted) {
        setState(() => _finishing = false);
        _reset();
      }
    }
  }

  void _reset() {
    _pollTimer?.cancel();
    _pollTimer = null;
    setState(() {
      _scanResult = null;
      _liveSession = null;
      _error = null;
      _isScanning = true;
      _isProcessing = false;
      _lastScannedToken = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_scanResult != null) {
      return _buildResult();
    }
    return _buildScannerView();
  }

  Widget _buildScannerView() {
    return Column(
      children: [
        Expanded(
          child: Stack(
            fit: StackFit.expand,
            children: [
              MobileScanner(
                controller: _controller,
                onDetect: _onDetect,
                errorBuilder: _buildCameraError,
              ),
              ValueListenableBuilder<MobileScannerState>(
                valueListenable: _controller,
                builder: (context, state, _) {
                  if (state.error != null) {
                    return const SizedBox.shrink();
                  }
                  return Stack(
                    fit: StackFit.expand,
                    children: [
                      IgnorePointer(
                        child: CustomPaint(
                          painter: _ScannerOverlayPainter(
                            reticleSize: _reticleSize,
                            color: ReLoopColors.brand400,
                          ),
                        ),
                      ),
                      Center(child: _buildScanLine()),
                      Positioned(
                        top: 0,
                        right: 0,
                        child: SafeArea(
                          child: Padding(
                            padding: const EdgeInsets.all(ReLoopSpacing.md),
                            child: _buildTorchButton(state),
                          ),
                        ),
                      ),
                    ],
                  );
                },
              ),
              if (_isProcessing) _buildProcessingOverlay(),
            ],
          ),
        ),
        _buildBottomPanel(),
      ],
    );
  }

  Widget _buildScanLine() {
    return SizedBox(
      width: _reticleSize,
      height: _reticleSize,
      child: ClipRRect(
        borderRadius: ReLoopRadius.brLg,
        child: AnimatedBuilder(
          animation: _scanLineController,
          builder: (context, _) {
            return Align(
              alignment: Alignment(0, (_scanLineController.value * 2) - 1),
              child: Container(
                height: 2,
                margin: const EdgeInsets.symmetric(horizontal: ReLoopSpacing.xl),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      ReLoopColors.brand400.withValues(alpha: 0),
                      ReLoopColors.brand400,
                      ReLoopColors.brand400.withValues(alpha: 0),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildTorchButton(MobileScannerState state) {
    final torchOn = state.torchState == TorchState.on;
    final unavailable = state.torchState == TorchState.unavailable;
    return _CircleIconButton(
      icon: torchOn ? Icons.flash_on : Icons.flash_off,
      active: torchOn,
      onPressed: unavailable ? null : () => unawaited(_controller.toggleTorch()),
    );
  }

  Widget _buildProcessingOverlay() {
    return Container(
      color: Colors.black54,
      child: const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: Colors.white),
            SizedBox(height: ReLoopSpacing.lg),
            Text(
              'Memproses...',
              style: TextStyle(color: Colors.white, fontSize: 16),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCameraError(BuildContext context, MobileScannerException error) {
    final denied = error.errorCode == MobileScannerErrorCode.permissionDenied;
    final message = denied
        ? 'Kami butuh akses kamera untuk memindai QR mesin. Izinkan aksesnya, lalu coba lagi.'
        : 'Kamera tidak tersedia sekarang. Coba lagi sebentar lagi.';

    return ColoredBox(
      color: context.reloopBackground,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(ReLoopSpacing.xxl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                denied ? Icons.no_photography_outlined : Icons.videocam_off_outlined,
                size: 56,
                color: context.reloopMuted,
              ),
              const SizedBox(height: ReLoopSpacing.lg),
              Text(
                denied ? 'Akses kamera dibutuhkan' : 'Kamera bermasalah',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: context.reloopForeground,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: ReLoopSpacing.sm),
              Text(
                message,
                style: TextStyle(color: context.reloopMuted, fontSize: 13),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: ReLoopSpacing.xl),
              ReLoopButton(
                label: 'Coba lagi',
                icon: Icons.refresh,
                expanded: false,
                onPressed: () => unawaited(_restartCamera()),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBottomPanel() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(ReLoopSpacing.xxl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_error != null) ...[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(ReLoopSpacing.md),
              decoration: BoxDecoration(
                color: context.reloopTone('danger').bg,
                borderRadius: ReLoopRadius.brSm,
                border: Border.all(color: context.reloopTone('danger').border),
              ),
              child: Text(
                _error!,
                style: TextStyle(
                  color: context.reloopTone('danger').text,
                  fontSize: 13,
                ),
                textAlign: TextAlign.center,
              ),
            ),
            const SizedBox(height: ReLoopSpacing.md),
            ReLoopButton(
              label: 'Scan lagi',
              icon: Icons.qr_code_scanner,
              variant: ReLoopButtonVariant.ghost,
              onPressed: _resumeScanning,
            ),
          ] else ...[
            Text(
              'Arahkan kamera ke QR mesin',
              style: TextStyle(color: context.reloopMuted, fontSize: 13),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: ReLoopSpacing.md),
            ReLoopButton(
              label: 'Masukkan kode manual',
              icon: Icons.keyboard_alt_outlined,
              variant: ReLoopButtonVariant.ghost,
              size: ReLoopButtonSize.sm,
              onPressed: _showManualEntryDialog,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildResult() {
    final result = _scanResult!;
    final machine = result.machine;
    final session = _liveSession ?? result.session;
    final items = session.items ?? const <DepositItem>[];
    final isLive = !_terminalSessionStatuses.contains(session.status);
    final totalReward = items.fold<int>(0, (sum, item) => sum + (item.rewardAmount ?? 0));

    return SingleChildScrollView(
      padding: const EdgeInsets.all(ReLoopSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ReLoopCard(
            child: Column(
              children: [
                Icon(
                  result.resumed ? Icons.refresh : Icons.check_circle,
                  color: ReLoopColors.brand500,
                  size: 48,
                ),
                const SizedBox(height: ReLoopSpacing.md),
                Text(
                  result.resumed ? 'Sesi Dilanjutkan' : 'Sesi Dimulai!',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: context.reloopForeground,
                  ),
                ),
                const SizedBox(height: ReLoopSpacing.xs),
                Text(
                  result.resumed
                      ? 'Kamu sudah punya sesi aktif di mesin ini'
                      : 'Masukkan sampahmu ke mesin',
                  style: TextStyle(color: context.reloopMuted, fontSize: 13),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: ReLoopSpacing.md),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    StatusBadge(statusKey: session.status),
                    if (isLive) ...[
                      const SizedBox(width: ReLoopSpacing.sm),
                      SizedBox(
                        width: 12,
                        height: 12,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: context.reloopMuted,
                        ),
                      ),
                      const SizedBox(width: ReLoopSpacing.xs),
                      Text(
                        'Memantau sesi…',
                        style: TextStyle(color: context.reloopMuted, fontSize: 12),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: ReLoopSpacing.lg),
          ReLoopCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Item Masuk',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: context.reloopForeground,
                      ),
                    ),
                    Text(
                      formatRupiah(totalReward),
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: ReLoopColors.brand600,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: ReLoopSpacing.md),
                if (items.isEmpty)
                  Text(
                    'Belum ada item. Masukkan sampah pertamamu ke mesin.',
                    style: TextStyle(color: context.reloopMuted, fontSize: 13),
                  )
                else
                  ...items.map(_buildItemRow),
              ],
            ),
          ),
          const SizedBox(height: ReLoopSpacing.lg),
          ReLoopCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Info Mesin',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: context.reloopForeground,
                  ),
                ),
                const SizedBox(height: ReLoopSpacing.md),
                _infoRow('Nama', machine.name),
                _infoRow('Kode', machine.machineCode),
                if (machine.organizationName != null)
                  _infoRow('Organisasi', machine.organizationName!),
                const SizedBox(height: ReLoopSpacing.sm),
                Row(
                  children: [
                    Text('Status: ', style: TextStyle(color: context.reloopMuted)),
                    StatusBadge(statusKey: machine.status),
                  ],
                ),
                if (machine.supportedWasteTypes != null &&
                    machine.supportedWasteTypes!.isNotEmpty) ...[
                  const SizedBox(height: ReLoopSpacing.sm),
                  Text('Jenis sampah:', style: TextStyle(color: context.reloopMuted)),
                  const SizedBox(height: ReLoopSpacing.xs),
                  Wrap(
                    spacing: ReLoopSpacing.xs + 2,
                    runSpacing: ReLoopSpacing.xs,
                    children: machine.supportedWasteTypes!
                        .map((wt) => Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: ReLoopSpacing.sm + 2,
                                  vertical: ReLoopSpacing.xs),
                              decoration: BoxDecoration(
                                color: context.reloopBrandSoft,
                                borderRadius: ReLoopRadius.brSm,
                                border: Border.all(color: context.reloopBrandSoftStrong),
                              ),
                              child: Text(
                                wt.name,
                                style: TextStyle(
                                  color: context.reloopBrandText,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ))
                        .toList(),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: ReLoopSpacing.xxl),
          ReLoopButton(
            label: 'Selesai',
            isLoading: _finishing,
            onPressed: _finishSession,
          ),
          const SizedBox(height: ReLoopSpacing.sm),
          ReLoopButton(
            label: 'Scan lagi',
            variant: ReLoopButtonVariant.ghost,
            onPressed: _finishing ? null : _reset,
          ),
        ],
      ),
    );
  }

  Widget _buildItemRow(DepositItem item) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.wasteType?.name ?? 'Item',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: context.reloopForeground,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  item.measuredWeightGrams != null
                      ? '${item.quantity}x · ${item.measuredWeightGrams} gram'
                      : '${item.quantity}x',
                  style: TextStyle(color: context.reloopMutedSoft, fontSize: 12),
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              StatusBadge(statusKey: item.status),
              const SizedBox(height: ReLoopSpacing.xs),
              Text(
                formatRupiah(item.rewardAmount ?? 0),
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: context.reloopMuted,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 90,
            child: Text(
              label,
              style: TextStyle(color: context.reloopMutedSoft, fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: context.reloopForeground,
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CircleIconButton extends StatelessWidget {
  const _CircleIconButton({
    required this.icon,
    required this.onPressed,
    this.active = false,
  });

  final IconData icon;
  final VoidCallback? onPressed;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: ReLoopA11y.minTouchTarget,
      height: ReLoopA11y.minTouchTarget,
      child: Material(
        color: active
            ? ReLoopColors.brand500
            : Colors.black.withValues(alpha: 0.45),
        shape: const CircleBorder(),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onPressed,
          child: Icon(icon, color: Colors.white, size: 22),
        ),
      ),
    );
  }
}

class _ScannerOverlayPainter extends CustomPainter {
  _ScannerOverlayPainter({required this.reticleSize, required this.color});

  final double reticleSize;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final cutout = Rect.fromCenter(
      center: center,
      width: reticleSize,
      height: reticleSize,
    );
    const double r = ReLoopRadius.lg;
    final rrect = RRect.fromRectAndRadius(cutout, const Radius.circular(r));

    final dimPath = Path()
      ..addRect(Rect.fromLTWH(0, 0, size.width, size.height))
      ..addRRect(rrect)
      ..fillType = PathFillType.evenOdd;
    canvas.drawPath(dimPath, Paint()..color = Colors.black.withValues(alpha: 0.55));

    const double len = 26;
    final markerPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final topLeft = Path()
      ..moveTo(cutout.left, cutout.top + r + len)
      ..lineTo(cutout.left, cutout.top + r)
      ..quadraticBezierTo(cutout.left, cutout.top, cutout.left + r, cutout.top)
      ..lineTo(cutout.left + r + len, cutout.top);

    final topRight = Path()
      ..moveTo(cutout.right - r - len, cutout.top)
      ..lineTo(cutout.right - r, cutout.top)
      ..quadraticBezierTo(cutout.right, cutout.top, cutout.right, cutout.top + r)
      ..lineTo(cutout.right, cutout.top + r + len);

    final bottomRight = Path()
      ..moveTo(cutout.right, cutout.bottom - r - len)
      ..lineTo(cutout.right, cutout.bottom - r)
      ..quadraticBezierTo(
          cutout.right, cutout.bottom, cutout.right - r, cutout.bottom)
      ..lineTo(cutout.right - r - len, cutout.bottom);

    final bottomLeft = Path()
      ..moveTo(cutout.left + r + len, cutout.bottom)
      ..lineTo(cutout.left + r, cutout.bottom)
      ..quadraticBezierTo(
          cutout.left, cutout.bottom, cutout.left, cutout.bottom - r)
      ..lineTo(cutout.left, cutout.bottom - r - len);

    canvas
      ..drawPath(topLeft, markerPaint)
      ..drawPath(topRight, markerPaint)
      ..drawPath(bottomRight, markerPaint)
      ..drawPath(bottomLeft, markerPaint);
  }

  @override
  bool shouldRepaint(covariant _ScannerOverlayPainter oldDelegate) =>
      oldDelegate.reticleSize != reticleSize || oldDelegate.color != color;
}
