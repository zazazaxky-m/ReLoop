import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/auth_provider.dart';
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
      final user = context.read<AuthProvider>().user;
      final trashBagCode = _extractTrashBagCode(qrData);
      final canUpdateTrashBag =
          user?.role == AppRole.ADMIN || user?.role == AppRole.SUPERADMIN;
      if (canUpdateTrashBag && trashBagCode != null) {
        await _handleTrashBagCode(trashBagCode);
        return;
      }

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
        machineCode =
            uri.queryParameters['machine'] ?? uri.queryParameters['m'];
        token = uri.queryParameters['token'] ?? uri.queryParameters['t'];
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
      final response = await api.post(
        '/api/scan',
        data: {'machineCode': machineCode, 'token': token},
      );

      HapticFeedback.heavyImpact();

      final data = response.data as Map<String, dynamic>;
      setState(() {
        _scanResult = ScanResult.fromJson(data);
        _isProcessing = false;
      });
    } on Exception catch (e) {
      HapticFeedback.vibrate();
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isProcessing = false;
        _isScanning = true;
      });
    }
  }

  String? _extractTrashBagCode(String qrData) {
    final raw = qrData.trim();
    if (raw.toUpperCase().startsWith('BAG-')) return raw;

    final uri = Uri.tryParse(raw);
    if (uri == null) return null;
    final queryCode =
        uri.queryParameters['qrCode'] ??
        uri.queryParameters['bag'] ??
        uri.queryParameters['code'];
    if (queryCode != null && queryCode.toUpperCase().startsWith('BAG-')) {
      return queryCode;
    }
    final bagSegment = uri.pathSegments
        .where((segment) => segment.toUpperCase().startsWith('BAG-'))
        .firstOrNull;
    return bagSegment;
  }

  Future<void> _handleTrashBagCode(String qrCode) async {
    try {
      final api = context.read<ApiClient>();
      final response = await api.get(
        '/api/trash-bags',
        queryParameters: {'qrCode': qrCode},
      );
      final data = response.data as Map<String, dynamic>;
      final bags = (data['bags'] as List?)?.cast<dynamic>() ?? [];
      if (bags.isEmpty) {
        throw Exception('Trash bag tidak ditemukan');
      }
      final bag = bags.first as Map<String, dynamic>;

      if (!mounted) return;
      setState(() {
        _isProcessing = false;
      });
      HapticFeedback.mediumImpact();

      final update = await _showTrashBagUpdateDialog(bag);
      if (update == null || !mounted) {
        _reset();
        return;
      }

      setState(() {
        _isProcessing = true;
      });
      await api.patch('/api/trash-bags', data: {'qrCode': qrCode, ...update});
      HapticFeedback.heavyImpact();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Trash bag berhasil diperbarui'),
          backgroundColor: ReLoopColors.success,
        ),
      );
      _reset();
    } catch (e) {
      HapticFeedback.vibrate();
      if (!mounted) return;
      setState(() {
        _error = ApiClient.getErrorMessage(e, includeDetails: true);
        _isProcessing = false;
        _isScanning = true;
      });
    }
  }

  Future<Map<String, dynamic>?> _showTrashBagUpdateDialog(
    Map<String, dynamic> bag,
  ) {
    var status = (bag['status'] as String?) ?? 'GOOD';
    if (!['GOOD', 'PARTIAL', 'POOR', 'NOT_RETURNED'].contains(status)) {
      status = 'GOOD';
    }
    var appCompleted = true;
    final weightCtrl = TextEditingController();
    final noteCtrl = TextEditingController();
    final trip = bag['trip'] as Map<String, dynamic>?;
    final campaign = trip?['campaign'] as Map<String, dynamic>?;
    final travelAgent = trip?['travelAgent'] as Map<String, dynamic>?;
    final wasteType = bag['wasteType'] as Map<String, dynamic>?;

    return showDialog<Map<String, dynamic>>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: Text('Update Trash Bag'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _dialogInfo('QR', bag['bagQrCode'] as String? ?? '-'),
                _dialogInfo('Trip', trip?['groupName'] as String? ?? '-'),
                if (campaign?['name'] != null)
                  _dialogInfo('Campaign', campaign!['name'] as String),
                if (travelAgent?['name'] != null)
                  _dialogInfo('Travel Agent', travelAgent!['name'] as String),
                if (wasteType?['name'] != null)
                  _dialogInfo('Pemilahan', wasteType!['name'] as String),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: status,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'Kondisi trash bag',
                  ),
                  items: const [
                    DropdownMenuItem(
                      value: 'GOOD',
                      child: Text('Baik / sesuai'),
                    ),
                    DropdownMenuItem(
                      value: 'PARTIAL',
                      child: Text('Sebagian sesuai'),
                    ),
                    DropdownMenuItem(
                      value: 'POOR',
                      child: Text('Buruk / tercampur'),
                    ),
                    DropdownMenuItem(
                      value: 'NOT_RETURNED',
                      child: Text('Tidak kembali'),
                    ),
                  ],
                  onChanged: (value) => setSt(() => status = value ?? 'GOOD'),
                ),
                const SizedBox(height: 8),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: appCompleted,
                  title: Text('Aplikasi selesai'),
                  onChanged: (value) => setSt(() => appCompleted = value),
                ),
                TextField(
                  controller: weightCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Berat aktual (kg)',
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: noteCtrl,
                  minLines: 2,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'Catatan'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text('Batal'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx, {
                'status': status,
                'appCompleted': appCompleted,
                if (weightCtrl.text.trim().isNotEmpty)
                  'actualWeightKg': double.tryParse(weightCtrl.text.trim()),
                if (noteCtrl.text.trim().isNotEmpty)
                  'notes': noteCtrl.text.trim(),
              }),
              child: Text('Simpan'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _dialogInfo(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 92,
            child: Text(
              label,
              style: TextStyle(color: context.reloopMuted, fontSize: 12),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                color: context.reloopForeground,
                fontWeight: FontWeight.w700,
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
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
    return Scaffold(body: _buildBody());
  }

  Widget _buildBody() {
    if (_scanResult != null) {
      return _buildResult();
    }
    final user = context.watch<AuthProvider>().user;
    final scanInstruction =
        user?.role == AppRole.ADMIN || user?.role == AppRole.SUPERADMIN
        ? 'Arahkan kamera ke QR trash bag'
        : 'Arahkan kamera ke QR code mesin';

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
                      color: context.reloopBrandText,
                      width: 2.5,
                    ),
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
              if (_isProcessing)
                Container(
                  color: Colors.black54,
                  child: Center(
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
                    color: context.reloopTone('danger').bg,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: context.reloopTone('danger').border,
                    ),
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
                const SizedBox(height: 16),
              ],
              Text(
                scanInstruction,
                style: TextStyle(color: context.reloopMuted, fontSize: 13),
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
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: context.reloopForeground,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  result.resumed
                      ? 'Anda sudah memiliki sesi aktif di mesin ini'
                      : 'Silakan masukkan sampah ke mesin',
                  style: TextStyle(color: context.reloopMuted, fontSize: 13),
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
                Text(
                  'Info Mesin',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: context.reloopForeground,
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
                    Text(
                      'Status: ',
                      style: TextStyle(color: context.reloopMuted),
                    ),
                    StatusBadge(statusKey: machine.status),
                  ],
                ),
                if (machine.supportedWasteTypes != null &&
                    machine.supportedWasteTypes!.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Jenis sampah:',
                    style: TextStyle(color: context.reloopMuted),
                  ),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: machine.supportedWasteTypes!
                        .map(
                          (wt) => Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: context.reloopBrandSoft,
                              borderRadius: BorderRadius.circular(6),
                              border: Border.all(
                                color: context.reloopBrandSoftStrong,
                              ),
                            ),
                            child: Text(
                              wt.name,
                              style: TextStyle(
                                color: context.reloopBrandText,
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        )
                        .toList(),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 24),
          ReLoopButton(label: 'Selesai / Kembali Scan', onPressed: _reset),
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
