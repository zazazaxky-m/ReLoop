import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../theme/colors.dart';

class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key});

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  MobileScannerController? _controller;
  bool _isScanning = true;
  bool _isProcessing = false;
  ScanResult? _scanResult;
  String? _error;
  String? _lastScannedToken;

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (!_isScanning || _isProcessing) return;

    final barcode = capture.barcodes.firstOrNull;
    if (barcode == null || barcode.rawValue == null) return;

    final raw = barcode.rawValue!;
    // Prevent re-scanning same token
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
        setState(() {
          _error = 'QR code tidak valid';
          _isProcessing = false;
          _isScanning = true;
        });
        return;
      }

      final segments = uri.pathSegments;
      String? machineCode;
      String? token;

      // Handle both: /scan?machine=XXX&token=YYY and /machine/XXX/display
      if (uri.path.contains('scan')) {
        machineCode = uri.queryParameters['machine'];
        token = uri.queryParameters['token'];
      } else if (segments.length >= 3 && segments[0] == 'machine') {
        machineCode = segments[1];
        token = uri.queryParameters['token'];
      }

      // Fallback: try parsing as direct machine code
      machineCode ??= qrData.trim();
      token ??= '';

      if (machineCode.isEmpty) {
        setState(() {
          _error = 'QR tidak mengandung kode mesin';
          _isProcessing = false;
          _isScanning = true;
        });
        return;
      }

      final api = context.read<ApiClient>();
      final response = await api.post('/api/scan', data: {
        'machineCode': machineCode,
        'token': token,
      });

      HapticFeedback.heavyImpact();

      final data = response.data as Map<String, dynamic>;
      setState(() {
        _scanResult = ScanResult.fromJson(data);
        _isProcessing = false;
      });
    } on Exception catch (e) {
      String msg = 'Gagal memproses QR';
      HapticFeedback.vibrate();
      if (e is DioException) {
        final errData = e.response?.data;
        if (errData is Map) {
          msg = errData['error'] as String? ?? msg;
        }
      }
      setState(() {
        _error = msg;
        _isProcessing = false;
        _isScanning = true;
      });
    }
  }

  void _reset() {
    setState(() {
      _scanResult = null;
      _error = null;
      _isScanning = true;
      _isProcessing = false;
      _lastScannedToken = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Scan Mesin'),
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_scanResult != null) {
      return _buildResult();
    }

    return Column(
      children: [
        Expanded(
          child: Stack(
            fit: StackFit.expand,
            children: [
              MobileScanner(
                controller: _controller = MobileScannerController(),
                onDetect: _onDetect,
              ),
              // Scan overlay
              Center(
                child: Container(
                  width: 250,
                  height: 250,
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: ReLoopColors.brand500,
                      width: 2.5,
                    ),
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
              if (_isProcessing)
                Container(
                  color: Colors.black54,
                  child: const Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        CircularProgressIndicator(color: Colors.white),
                        SizedBox(height: 16),
                        Text(
                          'Memproses...',
                          style: TextStyle(color: Colors.white, fontSize: 16),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              if (_error != null) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: ReLoopColors.tones['danger']!.bg,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: ReLoopColors.tones['danger']!.border),
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(
                      color: ReLoopColors.danger,
                      fontSize: 13,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
                const SizedBox(height: 16),
              ],
              const Text(
                'Arahkan kamera ke QR code mesin',
                style: TextStyle(color: ReLoopColors.muted, fontSize: 13),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildResult() {
    final result = _scanResult!;
    final machine = result.machine;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
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
                const SizedBox(height: 12),
                Text(
                  result.resumed ? 'Sesi Dilanjutkan' : 'Sesi Dimulai!',
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: ReLoopColors.foreground,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  result.resumed
                      ? 'Anda sudah memiliki sesi aktif di mesin ini'
                      : 'Silakan masukkan sampah ke mesin',
                  style: const TextStyle(color: ReLoopColors.muted, fontSize: 13),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          ReLoopCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Info Mesin',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: ReLoopColors.foreground,
                  ),
                ),
                const SizedBox(height: 12),
                _infoRow('Nama', machine.name),
                _infoRow('Kode', machine.machineCode),
                if (machine.organizationName != null)
                  _infoRow('Organisasi', machine.organizationName!),
                const SizedBox(height: 8),
                Row(
                  children: [
                    const Text('Status: ', style: TextStyle(color: ReLoopColors.muted)),
                    StatusBadge(statusKey: machine.status),
                  ],
                ),
                if (machine.supportedWasteTypes != null &&
                    machine.supportedWasteTypes!.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  const Text('Jenis sampah:', style: TextStyle(color: ReLoopColors.muted)),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: machine.supportedWasteTypes!
                        .map((wt) => Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: ReLoopColors.brand50,
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(color: ReLoopColors.brand200),
                              ),
                              child: Text(
                                wt.name,
                                style: const TextStyle(
                                  color: ReLoopColors.brand700,
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
          const SizedBox(height: 24),
          ReLoopButton(
            label: 'Selesai / Kembali Scan',
            onPressed: _reset,
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
              style: const TextStyle(color: ReLoopColors.mutedSoft, fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: ReLoopColors.foreground,
                fontSize: 13,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
