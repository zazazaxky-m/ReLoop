import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'admin_shell.dart';

class AdminPickupsScreen extends StatefulWidget {
  const AdminPickupsScreen({super.key});

  @override
  State<AdminPickupsScreen> createState() => _AdminPickupsScreenState();
}

class _AdminPickupsScreenState extends State<AdminPickupsScreen> {
  List<dynamic> _pickups = [];
  List<dynamic> _machines = [];
  List<dynamic> _partners = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final api = context.read<ApiClient>();
      final results = await Future.wait([
        api.get('/api/pickups'),
        api.get('/api/machines'),
        api.get('/api/partnerships', queryParameters: {'status': 'ACTIVE'}),
      ]);
      setState(() {
        _pickups = ((results[0].data as Map)['pickups'] as List?)?.cast<dynamic>() ?? [];
        _machines = ((results[1].data as Map)['machines'] as List?)?.cast<dynamic>() ?? [];
        _partners = ((results[2].data as Map)['partnerships'] as List?)?.cast<dynamic>() ?? [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = ApiClient.getErrorMessage(e); _isLoading = false; });
    }
  }

  Future<void> _act(String id, String action, {String? collectorUserId}) async {
    try {
      final api = context.read<ApiClient>();
      final body = <String, dynamic>{'action': action};
      if (collectorUserId != null) body['collectorUserId'] = collectorUserId;
      await api.patch('/api/pickups/$id', data: body);
      await _load();
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  Future<void> _createPickup() async {
    String? machineId;
    String reason = 'MANUAL';
    int priority = 0;
    String notes = '';

    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: const Text('Buat Pickup Baru'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              DropdownButtonFormField<String>(
                value: machineId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Mesin'),
                items: [
                  const DropdownMenuItem(value: null, child: Text('Pilih mesin...')),
                  ..._machines.map((m) => DropdownMenuItem(
                    value: (m['id'] as String?) ?? '',
                    child: Text('${m['name'] ?? ''} (${m['machineCode'] ?? ''})', overflow: TextOverflow.ellipsis),
                  )),
                ],
                onChanged: (v) => setSt(() => machineId = v),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: reason,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Alasan'),
                items: const [
                  DropdownMenuItem(value: 'FULL', child: Text('Penuh')),
                  DropdownMenuItem(value: 'SCHEDULED', child: Text('Terjadwal')),
                  DropdownMenuItem(value: 'MANUAL', child: Text('Manual')),
                  DropdownMenuItem(value: 'ERROR', child: Text('Error')),
                ],
                onChanged: (v) => setSt(() => reason = v ?? 'MANUAL'),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<int>(
                value: priority,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Prioritas'),
                items: List.generate(6, (i) => DropdownMenuItem(value: i, child: Text('P$i'))),
                onChanged: (v) => setSt(() => priority = v ?? 0),
              ),
              const SizedBox(height: 12),
              TextField(
                decoration: const InputDecoration(labelText: 'Catatan', hintText: 'Opsional'),
                maxLines: 2,
                onChanged: (v) => notes = v,
              ),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
            TextButton(
              onPressed: () => Navigator.pop(ctx, {'machineId': machineId, 'reason': reason, 'priority': priority, 'notes': notes}),
              child: const Text('Buat'),
            ),
          ],
        ),
      ),
    );
    if (result == null || result['machineId'] == null || !mounted) return;

    try {
      final api = context.read<ApiClient>();
      await api.post('/api/pickups', data: result);
      await _load();
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  Future<void> _assignCollector(String pickupId) async {
    String? collectorId;
    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: const Text('Tugaskan Pengepul'),
          content: DropdownButtonFormField<String>(
            value: collectorId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Pengepul'),
            items: [
              const DropdownMenuItem(value: null, child: Text('Pilih pengepul...')),
              ..._partners.map((p) {
                final c = p['collectorUser'] as Map<String, dynamic>?;
                final name = c?['name'] as String? ?? '';
                final email = c?['email'] as String? ?? '';
                final id = c?['id'] as String? ?? '';
                return DropdownMenuItem(value: id, child: Text('$name ($email)', overflow: TextOverflow.ellipsis));
              }),
            ],
            onChanged: (v) => setSt(() => collectorId = v),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
            TextButton(
              onPressed: () {
                Navigator.pop(ctx);
                if (collectorId != null) _act(pickupId, 'assign', collectorUserId: collectorId);
              },
              child: const Text('Tugaskan'),
            ),
          ],
        ),
      ),
    );
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: ReLoopColors.danger),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AdminShell(
      title: 'Pickup',
      child: RefreshIndicator(onRefresh: _load, child: _buildBody()),
    );
  }

  Widget _buildBody() {
    if (_isLoading) return ListView(padding: const EdgeInsets.all(16), children: const [SkeletonListTile(), SizedBox(height: 8), SkeletonListTile()]);
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.cloud_off, size: 48, color: ReLoopColors.mutedSoft),
        const SizedBox(height: 12),
        Text(_error ?? '', style: const TextStyle(color: ReLoopColors.muted)),
        TextButton(onPressed: _load, child: const Text('Coba Lagi')),
      ]));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ReLoopButton(label: 'Buat Pickup', icon: Icons.add, variant: ReLoopButtonVariant.primary, onPressed: _createPickup),
        const SizedBox(height: 16),
        if (_pickups.isEmpty)
          SizedBox(height: 120, child: Center(child: Text('Tidak ada pickup.', style: const TextStyle(color: ReLoopColors.mutedSoft))))
        else
          ..._pickups.map(_buildCard),
        const SizedBox(height: 80),
      ],
    );
  }

  Widget _buildCard(dynamic p) {
    final pickup = p as Map<String, dynamic>;
    final machine = pickup['machine'] as Map<String, dynamic>?;
    final collector = pickup['assignedCollector'] as Map<String, dynamic>?;
    final status = (pickup['status'] as String?) ?? 'REQUESTED';
    final reason = (pickup['reason'] as String?) ?? '-';
    final priority = (pickup['priority'] as num?)?.toInt() ?? 0;
    final itemCount = (pickup['_count']?['items'] as num?)?.toInt() ?? 0;
    final id = (pickup['id'] as String?) ?? '';

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: ReLoopCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(machine?['name'] as String? ?? 'Pickup #$id', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: ReLoopColors.foreground)),
              if (machine?['machineCode'] != null)
                Text(machine!['machineCode'] as String, style: const TextStyle(fontSize: 11, color: ReLoopColors.mutedSoft)),
            ])),
            if (priority > 0)
              Container(
                margin: const EdgeInsets.only(right: 8),
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: ReLoopColors.statusError.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(4)),
                child: Text('P$priority', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: ReLoopColors.statusError)),
              ),
            StatusBadge(statusKey: status),
          ]),
          const SizedBox(height: 4),
          Row(children: [
            _chip('Alasan: $reason'),
            const SizedBox(width: 8),
            _chip('$itemCount material'),
            if (collector != null) ...[
              const SizedBox(width: 8),
              _chip('${collector['name']}'),
            ],
          ]),
          if (pickup['notes'] != null) ...[
            const SizedBox(height: 4),
            Text(pickup['notes'] as String, maxLines: 2, overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11, color: ReLoopColors.mutedSoft, fontStyle: FontStyle.italic)),
          ],
          if (status == 'REQUESTED' || status == 'ASSIGNED') ...[
            const SizedBox(height: 8),
            Row(mainAxisAlignment: MainAxisAlignment.end, children: [
              ReLoopButton(label: 'Tugaskan', variant: ReLoopButtonVariant.outline, size: ReLoopButtonSize.sm, expanded: false,
                  onPressed: () => _assignCollector(id)),
              const SizedBox(width: 8),
              ReLoopButton(label: 'Batalkan', variant: ReLoopButtonVariant.ghost, size: ReLoopButtonSize.sm, expanded: false,
                  onPressed: () => _act(id, 'cancel')),
            ]),
          ],
        ]),
      ),
    );
  }

  Widget _chip(String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: ReLoopColors.background, borderRadius: BorderRadius.circular(6)),
      child: Text(label, style: const TextStyle(fontSize: 10, color: ReLoopColors.muted, fontWeight: FontWeight.w500)),
    );
  }
}
