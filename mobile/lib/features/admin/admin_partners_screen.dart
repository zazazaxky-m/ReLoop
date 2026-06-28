import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'admin_shell.dart';

class AdminPartnersScreen extends StatefulWidget {
  const AdminPartnersScreen({super.key});
  @override
  State<AdminPartnersScreen> createState() => _AdminPartnersScreenState();
}

class _AdminPartnersScreenState extends State<AdminPartnersScreen> {
  List<dynamic> _partners = [];
  bool _isLoading = true;
  String? _error;
  String? _statusFilter;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final res = await context.read<ApiClient>().get('/api/partnerships');
      setState(() {
        _partners = ((res.data as Map)['partnerships'] as List?)?.cast<dynamic>() ?? [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = ApiClient.getErrorMessage(e); _isLoading = false; });
    }
  }

  Future<void> _act(String id, String action) async {
    try {
      await context.read<ApiClient>().patch('/api/partnerships/$id', data: {'action': action});
      await _load();
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  Future<void> _remove(String id, String name) async {
    final ok = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Hapus Kemitraan?'),
      content: Text('Hapus kemitraan dengan "$name"?'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
        TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Hapus', style: TextStyle(color: ReLoopColors.danger))),
      ],
    ));
    if (ok != true || !mounted) return;
    await _act(id, 'remove');
  }

  Future<void> _invite() async {
    final emailCtrl = TextEditingController();
    final notesCtrl = TextEditingController();
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Undang Pengepul'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: emailCtrl, decoration: const InputDecoration(labelText: 'Email pengepul', hintText: 'pengepul@reloop.id'), keyboardType: TextInputType.emailAddress),
          const SizedBox(height: 8),
          TextField(controller: notesCtrl, decoration: const InputDecoration(labelText: 'Catatan (opsional)'), maxLines: 2),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
          TextButton(onPressed: () => Navigator.pop(ctx, {'email': emailCtrl.text.trim(), 'notes': notesCtrl.text.trim()}), child: const Text('Undang')),
        ],
      ),
    );
    if (result == null || (result['email']?.isEmpty ?? true) || !mounted) return;
    try {
      await context.read<ApiClient>().post('/api/partnerships', data: {
        'collectorEmail': result['email'],
        if ((result['notes']?.isNotEmpty ?? false)) 'notes': result['notes'],
      });
      await _load();
      _showSuccess('Undangan dikirim');
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  void _showError(String msg) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: ReLoopColors.danger));
  void _showSuccess(String msg) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: ReLoopColors.success));

  @override
  Widget build(BuildContext context) {
    return AdminShell(
      title: 'Mitra Pengepul',
      child: Column(
        children: [
          _buildFilterChips(),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: _buildBody(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChips() {
    const statuses = ['REQUESTED', 'ACTIVE', 'SUSPENDED', 'INVITED'];
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: [
        FilterChip(
          label: const Text('Semua'),
          selected: _statusFilter == null,
          onSelected: (_) => setState(() => _statusFilter = null),
        ),
        const SizedBox(width: 6),
        ...statuses.map((s) => Padding(
          padding: const EdgeInsets.only(right: 6),
          child: FilterChip(
            label: Text(_statusLabel(s)),
            selectedColor: ReLoopColors.brand50,
            selected: _statusFilter == s,
            onSelected: (_) => setState(() => _statusFilter = _statusFilter == s ? null : s),
          ),
        )),
      ])),
    );
  }

  String _statusLabel(String s) {
    switch (s) {
      case 'REQUESTED': return 'Diminta';
      case 'ACTIVE': return 'Aktif';
      case 'SUSPENDED': return 'Ditangguhkan';
      case 'INVITED': return 'Diundang';
      default: return s;
    }
  }

  Widget _buildBody() {
    if (_isLoading) return ListView(padding: const EdgeInsets.all(16), children: const [SkeletonListTile(), SizedBox(height: 8), SkeletonListTile()]);
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.cloud_off, size: 48, color: ReLoopColors.mutedSoft), const SizedBox(height: 12),
        Text(_error ?? '', style: const TextStyle(color: ReLoopColors.muted)),
        TextButton(onPressed: _load, child: const Text('Coba Lagi')),
      ]));
    }
    
    final filtered = _statusFilter == null
        ? _partners
        : _partners.where((p) => p['status'] == _statusFilter).toList();

    return ListView(padding: const EdgeInsets.all(16), children: [
      ReLoopButton(label: 'Undang Pengepul', icon: Icons.person_add, variant: ReLoopButtonVariant.primary, onPressed: _invite),
      const SizedBox(height: 16),
      if (filtered.isEmpty)
        SizedBox(height: 120, child: Center(child: Text('Belum ada mitra.', style: const TextStyle(color: ReLoopColors.mutedSoft))))
      else
        ...filtered.map((p) {
          final partner = p as Map<String, dynamic>;
          final collector = partner['collectorUser'] as Map<String, dynamic>?;
          final org = partner['organization'] as Map<String, dynamic>?;
          final status = (partner['status'] as String?) ?? 'REQUESTED';
          final id = (partner['id'] as String?) ?? '';
          final serviceArea = partner['serviceAreaJson'] as Map<String, dynamic>?;
          final regions = (serviceArea?['regions'] as List?)?.join(', ') ?? '';

          return Padding(padding: const EdgeInsets.only(bottom: 8), child: ReLoopCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text((collector?['name'] as String?) ?? 'Pengepul', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: ReLoopColors.foreground)),
                if (collector?['email'] != null) Text(collector!['email'] as String, style: const TextStyle(fontSize: 11, color: ReLoopColors.mutedSoft)),
                if (collector?['phone'] != null) Text('Telp: ${collector!['phone']}', style: const TextStyle(fontSize: 11, color: ReLoopColors.mutedSoft)),
                if (org != null) Text(org['name'] as String? ?? '', style: const TextStyle(fontSize: 11, color: ReLoopColors.mutedSoft)),
                if (regions.isNotEmpty) Text('Wilayah: $regions', style: const TextStyle(fontSize: 11, color: ReLoopColors.mutedSoft)),
              ])),
              StatusBadge(statusKey: status),
            ]),
            const SizedBox(height: 8),
            Row(mainAxisAlignment: MainAxisAlignment.end, children: _actions(status, id, collector?['name'] as String? ?? '')),
          ])));
        }),
      const SizedBox(height: 80),
    ]);
  }

  List<Widget> _actions(String status, String id, String name) {
    final buttons = <Widget>[];
    switch (status) {
      case 'REQUESTED':
        buttons.addAll([
          ReLoopButton(label: 'Terima', variant: ReLoopButtonVariant.primary, size: ReLoopButtonSize.sm, expanded: false, onPressed: () => _act(id, 'accept')),
          const SizedBox(width: 8),
          ReLoopButton(label: 'Tolak', variant: ReLoopButtonVariant.ghost, size: ReLoopButtonSize.sm, expanded: false, onPressed: () => _act(id, 'decline')),
        ]);
        break;
      case 'ACTIVE':
        buttons.addAll([
          ReLoopButton(label: 'Tangguhkan', variant: ReLoopButtonVariant.outline, size: ReLoopButtonSize.sm, expanded: false, onPressed: () => _act(id, 'suspend')),
          const SizedBox(width: 8),
          ReLoopButton(label: 'Hapus', variant: ReLoopButtonVariant.ghost, size: ReLoopButtonSize.sm, expanded: false, onPressed: () => _remove(id, name)),
        ]);
        break;
      case 'SUSPENDED':
        buttons.addAll([
          ReLoopButton(label: 'Aktifkan', variant: ReLoopButtonVariant.outline, size: ReLoopButtonSize.sm, expanded: false, onPressed: () => _act(id, 'reactivate')),
          const SizedBox(width: 8),
          ReLoopButton(label: 'Hapus', variant: ReLoopButtonVariant.ghost, size: ReLoopButtonSize.sm, expanded: false, onPressed: () => _remove(id, name)),
        ]);
        break;
      case 'INVITED':
      case 'PENDING_SUPERADMIN_APPROVAL':
        buttons.add(ReLoopButton(label: 'Hapus', variant: ReLoopButtonVariant.ghost, size: ReLoopButtonSize.sm, expanded: false, onPressed: () => _remove(id, name)));
        break;
    }
    return buttons;
  }
}
