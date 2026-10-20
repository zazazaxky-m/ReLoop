import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/format.dart';
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

  /// B05: every dispatch decision carries the `version` this screen loaded.
  Future<void> _act(Map<String, dynamic> pickup, String action,
      {String? collectorUserId, String? reason, String? expectedStartAt}) async {
    final id = (pickup['id'] as String?) ?? '';
    try {
      final api = context.read<ApiClient>();
      final body = <String, dynamic>{'action': action};
      final version = (pickup['version'] as num?)?.toInt();
      if (version != null) body['expectedVersion'] = version;
      if (collectorUserId != null) body['collectorUserId'] = collectorUserId;
      if (reason != null) body['reason'] = reason;
      if (expectedStartAt != null) body['expectedStartAt'] = expectedStartAt;
      await api.patch('/api/pickups/$id', data: body);
      await _load();
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
      // 409: another admin changed the task; show the current version.
      if (e is DioException && e.response?.statusCode == 409 && mounted) await _load();
    }
  }

  Future<void> _createReplacement(String closedId) async {
    try {
      final api = context.read<ApiClient>();
      await api.post('/api/pickups', data: {'replacesPickupId': closedId});
      await _load();
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  Future<void> _cancelPickup(Map<String, dynamic> pickup) async {
    var reasonText = '';
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Batalkan pickup ini?'),
        content: TextField(
          onChanged: (v) => reasonText = v,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'Alasan pembatalan',
            hintText: 'Wajib; dikirim ke pengepul yang ditugaskan',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Kembali')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, reasonText.trim()),
            child: const Text('Batalkan Pickup'),
          ),
        ],
      ),
    );
    if (reason == null || !mounted) return;
    if (reason.length < 3) {
      _showError('Alasan wajib diisi (3-500 karakter)');
      return;
    }
    await _act(pickup, 'cancel', reason: reason);
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
          title: Text('Buat Pickup Baru'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              DropdownButtonFormField<String>(
                initialValue: machineId,
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
                initialValue: reason,
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
                initialValue: priority,
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
            TextButton(onPressed: () => Navigator.pop(ctx), child: Text('Batal')),
            TextButton(
              onPressed: () => Navigator.pop(ctx, {'machineId': machineId, 'reason': reason, 'priority': priority, 'notes': notes}),
              child: Text('Buat'),
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

  Future<void> _assignCollector(Map<String, dynamic> pickup) async {
    String? collectorId;
    DateTime? deadline;
    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: Text('Tugaskan Pengepul'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            DropdownButtonFormField<String>(
              initialValue: collectorId,
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
            const SizedBox(height: 12),
            // B05: the start deadline is chosen by the admin; there is no default.
            TextButton.icon(
              icon: const Icon(Icons.schedule),
              label: Text(deadline == null
                  ? 'Tenggat mulai (opsional)'
                  : 'Tenggat mulai: ${formatDateTime(deadline!)}'),
              onPressed: () async {
                final now = DateTime.now();
                final day = await showDatePicker(
                  context: ctx,
                  initialDate: now,
                  firstDate: now,
                  lastDate: now.add(const Duration(days: 365)),
                );
                if (day == null || !ctx.mounted) return;
                final time = await showTimePicker(context: ctx, initialTime: TimeOfDay.fromDateTime(now));
                if (time == null || !ctx.mounted) return;
                setSt(() => deadline = DateTime(day.year, day.month, day.day, time.hour, time.minute));
              },
            ),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: Text('Batal')),
            TextButton(
              onPressed: () {
                Navigator.pop(ctx);
                if (collectorId != null) {
                  _act(pickup, 'assign',
                      collectorUserId: collectorId,
                      expectedStartAt: deadline?.toUtc().toIso8601String());
                }
              },
              child: Text('Tugaskan'),
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
        Icon(Icons.cloud_off, size: 48, color: context.reloopMutedSoft),
        const SizedBox(height: 12),
        Text(_error ?? '', style: TextStyle(color: context.reloopMuted)),
        TextButton(onPressed: _load, child: Text('Coba Lagi')),
      ]));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ReLoopButton(label: 'Buat Pickup', icon: Icons.add, variant: ReLoopButtonVariant.primary, onPressed: _createPickup),
        const SizedBox(height: 16),
        if (_pickups.isEmpty)
          SizedBox(height: 120, child: Center(child: Text('Tidak ada pickup.', style: TextStyle(color: context.reloopMutedSoft))))
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
    final dispatch = pickup['dispatch'] as Map<String, dynamic>?;
    final overdue = dispatch?['overdue'] == true;
    final nextLabel = dispatch?['nextLabel'] as String?;
    final assignedAt = pickup['assignedAt'] as String?;
    final deadline = pickup['expectedStartAt'] as String?;
    final closedReason = pickup['closedReason'] as String?;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: ReLoopCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(machine?['name'] as String? ?? 'Pickup #$id', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: context.reloopForeground)),
              if (machine?['machineCode'] != null)
                Text(machine!['machineCode'] as String, style: TextStyle(fontSize: 11, color: context.reloopMutedSoft)),
            ])),
            if (priority > 0)
              Container(
                margin: const EdgeInsets.only(right: 8),
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: ReLoopColors.statusError.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(4)),
                child: Text('P$priority', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: ReLoopColors.statusError)),
              ),
            StatusBadge(statusKey: status),
          ]),
          const SizedBox(height: 4),
          Row(children: [
            _chip('Alasan: $reason', context),
            const SizedBox(width: 8),
            _chip('$itemCount material', context),
            if (collector != null) ...[
              const SizedBox(width: 8),
              _chip('${collector['name']}', context),
            ],
          ]),
          // B05: who acts next (PIC), when they were dispatched and the admin's deadline.
          if (nextLabel != null) ...[
            const SizedBox(height: 6),
            Text('Langkah berikutnya: $nextLabel',
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: overdue ? FontWeight.w700 : FontWeight.w500,
                    color: overdue ? ReLoopColors.statusError : context.reloopForeground)),
          ],
          if (collector != null)
            Text('PIC: ${collector['name']}${assignedAt != null ? ' · ditugaskan ${formatDateTimeIso(assignedAt)}' : ''}',
                style: TextStyle(fontSize: 11, color: context.reloopMuted)),
          if (deadline != null || status == 'ASSIGNED')
            Text(deadline != null
                    ? 'Tenggat mulai: ${formatDateTimeIso(deadline)}${overdue ? ' (terlambat)' : ''}'
                    : 'Tenggat mulai: tanpa tenggat',
                style: TextStyle(fontSize: 11, color: overdue ? ReLoopColors.statusError : context.reloopMuted)),
          if (closedReason != null)
            Text('Alasan: $closedReason', style: TextStyle(fontSize: 11, color: context.reloopMuted)),
          if (pickup['notes'] != null) ...[
            const SizedBox(height: 4),
            Text(pickup['notes'] as String, maxLines: 2, overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, color: context.reloopMutedSoft, fontStyle: FontStyle.italic)),
          ],
          if (['REQUESTED', 'ASSIGNED', 'ON_THE_WAY', 'ARRIVED'].contains(status)) ...[
            const SizedBox(height: 8),
            Row(mainAxisAlignment: MainAxisAlignment.end, children: [
              // Reassignment only before field work starts.
              if (status == 'REQUESTED' || status == 'ASSIGNED') ...[
                ReLoopButton(label: status == 'ASSIGNED' ? 'Ganti' : 'Tugaskan', variant: ReLoopButtonVariant.outline, size: ReLoopButtonSize.sm, expanded: false,
                    onPressed: () => _assignCollector(pickup)),
                const SizedBox(width: 8),
              ],
              ReLoopButton(label: 'Batalkan', variant: ReLoopButtonVariant.ghost, size: ReLoopButtonSize.sm, expanded: false,
                  onPressed: () => _cancelPickup(pickup)),
            ]),
          ],
          if (dispatch?['needsReplacement'] == true) ...[
            const SizedBox(height: 8),
            Row(mainAxisAlignment: MainAxisAlignment.end, children: [
              ReLoopButton(label: 'Buat Pengganti', variant: ReLoopButtonVariant.outline, size: ReLoopButtonSize.sm, expanded: false,
                  onPressed: () => _createReplacement(id)),
            ]),
          ],
        ]),
      ),
    );
  }

  Widget _chip(String label, BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: context.reloopBackground, borderRadius: BorderRadius.circular(6)),
      child: Text(label, style: TextStyle(fontSize: 10, color: context.reloopMuted, fontWeight: FontWeight.w500)),
    );
  }
}
