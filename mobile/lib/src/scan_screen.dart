import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'api_client.dart';

class ScanScreen extends StatefulWidget {
  const ScanScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends State<ScanScreen> {
  final controller = MobileScannerController();
  bool processing = false;
  Map<String, dynamic>? session;
  Timer? poller;
  String? error;

  @override
  void dispose() {
    poller?.cancel();
    controller.dispose();
    super.dispose();
  }

  ({String code, String token})? _parsePayload(String rawValue) {
    final raw = rawValue.trim();
    final uri = Uri.tryParse(raw);
    final parameters = uri?.queryParameters ?? const <String, String>{};
    var code = parameters['m'] ?? parameters['machine'];
    var token = parameters['t'] ?? parameters['token'];

    // Beberapa scanner mengembalikan query saja, tanpa URL lengkap.
    if (code == null || token == null) {
      final query = raw.contains('?') ? raw.split('?').last : raw;
      try {
        final fallback = Uri.splitQueryString(query);
        code = fallback['m'] ?? fallback['machine'];
        token = fallback['t'] ?? fallback['token'];
      } on FormatException {
        return null;
      }
    }

    if (code == null || code.isEmpty || token == null || token.isEmpty) {
      return null;
    }
    return (code: code, token: token);
  }

  Future<void> detect(BarcodeCapture capture) async {
    if (processing || session != null || capture.barcodes.isEmpty) return;
    final value = capture.barcodes.first.rawValue;
    if (value == null) return;

    final payload = _parsePayload(value);
    if (payload == null) {
      setState(() => error = 'QR bukan QR mesin ReLoop yang valid.');
      return;
    }

    setState(() {
      processing = true;
      error = null;
    });
    try {
      final data = await widget.api.post('/api/scan', {
        'machineCode': payload.code,
        'token': payload.token,
      });
      session = data['session'] as Map<String, dynamic>;
      await controller.stop();
      poller = Timer.periodic(const Duration(seconds: 2), (_) => refresh());
      if (mounted) setState(() {});
    } on ApiException catch (exception) {
      if (mounted) setState(() => error = exception.message);
    } finally {
      if (mounted) setState(() => processing = false);
    }
  }

  Future<void> refresh() async {
    if (session == null) return;
    try {
      final data = await widget.api.get('/api/sessions/${session!['id']}');
      if (mounted) {
        setState(() => session = data['session'] as Map<String, dynamic>);
      }
    } catch (_) {
      // Polling berikutnya akan mencoba lagi.
    }
  }

  Future<void> finish(String action) async {
    if (session == null) return;
    try {
      final data = await widget.api.patch('/api/sessions/${session!['id']}', {
        'action': action,
      });
      poller?.cancel();
      if (mounted) {
        setState(() => session = data['session'] as Map<String, dynamic>);
      }
    } on ApiException catch (exception) {
      if (mounted) setState(() => error = exception.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (session != null) return _sessionView();
    return Stack(
      children: [
        MobileScanner(controller: controller, onDetect: detect),
        Center(
          child: Container(
            width: 250,
            height: 250,
            decoration: BoxDecoration(
              border: Border.all(color: Colors.white, width: 3),
              borderRadius: BorderRadius.circular(24),
            ),
          ),
        ),
        Positioned(
          left: 20,
          right: 20,
          bottom: 30,
          child: Card(
            color: Colors.white.withValues(alpha: .94),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Text(
                    processing
                        ? 'Menghubungkan ke mesin…'
                        : 'Arahkan kamera ke QR dinamis mesin',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  if (error != null) ...[
                    const SizedBox(height: 8),
                    Text(error!, style: const TextStyle(color: Colors.red)),
                  ],
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _sessionView() {
    final items = session!['items'] as List? ?? [];
    final status = session!['status'].toString();
    final terminal = ['COMPLETED', 'CANCELLED', 'EXPIRED'].contains(status);
    final totalQuantity = items.fold<int>(
      0,
      (sum, item) => sum + (((item as Map)['quantity'] as num?)?.toInt() ?? 0),
    );
    final totalReward = items.fold<int>(
      0,
      (sum, item) =>
          sum + (((item as Map)['rewardAmount'] as num?)?.toInt() ?? 0),
    );
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              children: [
                const Icon(
                  Icons.recycling_rounded,
                  size: 56,
                  color: Colors.green,
                ),
                const SizedBox(height: 12),
                Text(
                  (session!['machine'] as Map?)?['name']?.toString() ??
                      'Mesin ReLoop',
                  style: const TextStyle(
                    fontSize: 21,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Chip(label: Text(status.replaceAll('_', ' '))),
                const SizedBox(height: 8),
                Text('$totalQuantity item terdeteksi'),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Chip(label: Text('Total $totalQuantity pcs')),
                    const SizedBox(width: 8),
                    Chip(label: Text('Reward Rp$totalReward')),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 14),
        for (final raw in items)
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.recycling_outlined)),
            title: Text(
              ((raw as Map)['wasteType'] as Map?)?['name']?.toString() ??
                  'Item',
            ),
            subtitle: Text('Status: ${raw['status']} • Qty ${raw['quantity']}'),
            trailing: Text('Rp${raw['rewardAmount']}'),
          ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(error!, style: const TextStyle(color: Colors.red)),
          ),
        if (!terminal)
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => finish('cancel'),
                  child: const Text('Batalkan'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton(
                  onPressed: () => finish('finish'),
                  child: const Text('Selesai'),
                ),
              ),
            ],
          )
        else
          FilledButton.icon(
            onPressed: () async {
              setState(() {
                session = null;
                error = null;
              });
              await controller.start();
            },
            icon: const Icon(Icons.qr_code_scanner),
            label: const Text('Scan lagi'),
          ),
      ],
    );
  }
}
