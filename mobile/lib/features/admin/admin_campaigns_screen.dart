import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'admin_shell.dart';

class AdminCampaignsScreen extends StatefulWidget {
  const AdminCampaignsScreen({super.key});

  @override
  State<AdminCampaignsScreen> createState() => _AdminCampaignsScreenState();
}

class _AdminCampaignsScreenState extends State<AdminCampaignsScreen> {
  List<dynamic> _campaigns = [];
  bool _isLoading = true;
  String? _error;

  static const _types = ['MACHINE_DEPOSIT', 'TRASH_BAG', 'EVENT', 'SCHOOL_PROGRAM', 'TOURISM_PROGRAM'];
  static const _rewardModes = ['MONEY_REWARD', 'COMPLIANCE_ONLY'];
  static const _statuses = ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED'];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final res = await context.read<ApiClient>().get('/api/campaigns');
      setState(() {
        _campaigns = ((res.data as Map)['campaigns'] as List?)?.cast<dynamic>() ?? [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = ApiClient.getErrorMessage(e); _isLoading = false; });
    }
  }

  Future<void> _save({String? id}) async {
    final isEdit = id != null;
    final existing = isEdit ? _campaigns.firstWhere((c) => c['id'] == id) as Map<String, dynamic> : null;

    final nameCtrl = TextEditingController(text: existing?['name'] ?? '');
    final descCtrl = TextEditingController(text: existing?['description'] ?? '');
    String type = existing?['campaignType'] ?? 'MACHINE_DEPOSIT';
    String rewardMode = existing?['rewardMode'] ?? 'MONEY_REWARD';
    String visibility = existing?['visibility'] ?? 'PUBLIC';
    String status = existing?['status'] ?? 'DRAFT';
    String startAt = existing?['startAt'] != null ? (existing!['startAt'] as String).substring(0, 10) : '';
    String endAt = existing?['endAt'] != null ? (existing!['endAt'] as String).substring(0, 10) : '';
    String rewardMult = existing?['rewardMultiplier']?.toString() ?? '';
    final domainsCtrl = TextEditingController(
      text: existing?['allowedEmailDomains'] != null
          ? (existing!['allowedEmailDomains'] as List).join('\n')
          : '',
    );

    final startAtCtrl = TextEditingController(text: startAt);
    final endAtCtrl = TextEditingController(text: endAt);

    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: Text(isEdit ? 'Edit Campaign' : 'Campaign Baru'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Nama', hintText: 'wajib')),
              const SizedBox(height: 10),
              TextField(controller: descCtrl, decoration: const InputDecoration(labelText: 'Deskripsi'), maxLines: 2),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(initialValue: type, isExpanded: true, decoration: const InputDecoration(labelText: 'Tipe'),
                items: _types.map((t) => DropdownMenuItem(value: t, child: Text(_typeLabel(t)))).toList(),
                onChanged: (v) => setSt(() => type = v ?? 'MACHINE_DEPOSIT')),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(
                initialValue: rewardMode,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Mode Reward'),
                items: _rewardModes
                    .map((mode) => DropdownMenuItem(value: mode, child: Text(_rewardModeLabel(mode))))
                    .toList(),
                onChanged: (v) => setSt(() => rewardMode = v ?? 'MONEY_REWARD'),
              ),
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(initialValue: visibility, isExpanded: true, decoration: const InputDecoration(labelText: 'Visibilitas'),
                items: const [DropdownMenuItem(value: 'PUBLIC', child: Text('Publik')), DropdownMenuItem(value: 'PRIVATE', child: Text('Privat'))],
                onChanged: (v) => setSt(() => visibility = v ?? 'PUBLIC')),
              if (visibility == 'PRIVATE') ...[
                const SizedBox(height: 10),
                TextField(
                  controller: domainsCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Domain Email yang Diizinkan',
                    hintText: 'Cth: @domain.com\nSatu domain per baris',
                  ),
                  maxLines: 3,
                ),
              ],
              const SizedBox(height: 10),
              DropdownButtonFormField<String>(initialValue: status, isExpanded: true, decoration: const InputDecoration(labelText: 'Status'),
                items: _statuses.map((s) => DropdownMenuItem(value: s, child: Text(_statusLabel(s)))).toList(),
                onChanged: (v) => setSt(() => status = v ?? 'DRAFT')),
              const SizedBox(height: 10),
              GestureDetector(
                onTap: () async {
                  final initial = DateTime.tryParse(startAt) ?? DateTime.now();
                  final picked = await showDatePicker(
                    context: ctx,
                    initialDate: initial,
                    firstDate: DateTime(2000),
                    lastDate: DateTime(2100),
                  );
                  if (picked != null) {
                    setSt(() {
                      startAt = picked.toString().substring(0, 10);
                      startAtCtrl.text = startAt;
                    });
                  }
                },
                child: AbsorbPointer(
                  child: TextField(
                    controller: startAtCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Mulai (YYYY-MM-DD)',
                      hintText: 'opsional',
                      suffixIcon: Icon(Icons.calendar_today, size: 18),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              GestureDetector(
                onTap: () async {
                  final initial = DateTime.tryParse(endAt) ?? DateTime.now();
                  final picked = await showDatePicker(
                    context: ctx,
                    initialDate: initial,
                    firstDate: DateTime(2000),
                    lastDate: DateTime(2100),
                  );
                  if (picked != null) {
                    setSt(() {
                      endAt = picked.toString().substring(0, 10);
                      endAtCtrl.text = endAt;
                    });
                  }
                },
                child: AbsorbPointer(
                  child: TextField(
                    controller: endAtCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Selesai (YYYY-MM-DD)',
                      hintText: 'opsional',
                      suffixIcon: Icon(Icons.calendar_today, size: 18),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              TextField(controller: TextEditingController(text: rewardMult), decoration: const InputDecoration(labelText: 'Multiplier Reward', hintText: 'cth: 1.5'),
                keyboardType: TextInputType.number, onChanged: (v) => rewardMult = v),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
            TextButton(onPressed: () {
              final domains = visibility == 'PRIVATE'
                  ? domainsCtrl.text
                      .split('\n')
                      .map((e) => e.trim())
                      .where((e) => e.isNotEmpty)
                      .toList()
                  : [];
              Navigator.pop(ctx, {
                'name': nameCtrl.text.trim(),
                'description': descCtrl.text.trim().isEmpty ? null : descCtrl.text.trim(),
                'campaignType': type,
                'rewardMode': rewardMode,
                'visibility': visibility,
                'status': status,
                'startAt': startAt.isEmpty ? null : startAt,
                'endAt': endAt.isEmpty ? null : endAt,
                'rewardMultiplier': rewardMult.isEmpty ? null : double.tryParse(rewardMult),
                'allowedEmailDomains': domains,
              });
            }, child: const Text('Simpan')),
          ],
        ),
      ),
    );
    if (result == null || (result['name'] as String?)?.isEmpty == true || !mounted) return;

    try {
      final api = context.read<ApiClient>();
      if (isEdit) {
        await api.patch('/api/campaigns/$id', data: result);
      } else {
        await api.post('/api/campaigns', data: result);
      }
      await _load();
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  Future<void> _delete(String id) async {
    final confirm = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Hapus Campaign?'),
      content: const Text('Campaign dengan sesi akan diakhiri, bukan dihapus.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
        TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Hapus', style: TextStyle(color: ReLoopColors.danger))),
      ],
    ));
    if (confirm != true || !mounted) return;
    try {
      await context.read<ApiClient>().delete('/api/campaigns/$id');
      await _load();
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: ReLoopColors.danger));
  }

  @override
  Widget build(BuildContext context) {
    return AdminShell(title: 'Campaign', child: RefreshIndicator(onRefresh: _load, child: _buildBody()));
  }

  Widget _buildBody() {
    if (_isLoading) return ListView(padding: const EdgeInsets.all(16), children: const [SkeletonListTile(), SizedBox(height: 8), SkeletonListTile()]);
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.cloud_off, size: 48, color: ReLoopColors.mutedSoft),
        const SizedBox(height: 12), Text(_error ?? '', style: const TextStyle(color: ReLoopColors.muted)),
        TextButton(onPressed: _load, child: const Text('Coba Lagi')),
      ]));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ReLoopButton(label: 'Buat Campaign', icon: Icons.add, variant: ReLoopButtonVariant.primary, onPressed: () => _save()),
        const SizedBox(height: 16),
        if (_campaigns.isEmpty)
          SizedBox(height: 120, child: Center(child: Text('Belum ada campaign.', style: const TextStyle(color: ReLoopColors.mutedSoft))))
        else
          ..._campaigns.map(_buildCard),
        const SizedBox(height: 80),
      ],
    );
  }

  Widget _buildCard(dynamic c) {
    final campaign = c as Map<String, dynamic>;
    final status = (campaign['status'] as String?) ?? 'DRAFT';
    final sessions = (campaign['_count']?['sessions'] as num?)?.toInt() ?? 0;
    final id = (campaign['id'] as String?) ?? '';
    final allowedDomains = campaign['allowedEmailDomains'] as List?;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: ReLoopCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text((campaign['name'] as String?) ?? '', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: ReLoopColors.foreground))),
            StatusBadge(statusKey: status),
          ]),
          if (campaign['description'] != null) ...[
            const SizedBox(height: 4),
            Text(campaign['description'] as String, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
          ],
          if (campaign['visibility'] == 'PRIVATE' && allowedDomains != null && allowedDomains.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              'Domain: ${allowedDomains.join(", ")}',
              style: const TextStyle(fontSize: 11, color: ReLoopColors.brand600, fontWeight: FontWeight.w500),
            ),
          ],
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 4, children: [
            _chip(_typeLabel(campaign['campaignType'] as String? ?? 'MACHINE_DEPOSIT')),
            _chip(_rewardModeLabel(campaign['rewardMode'] as String? ?? 'MONEY_REWARD')),
            _chip((campaign['visibility'] as String?) ?? 'PUBLIC'),
            if (sessions > 0) _chip('$sessions sesi'),
            if (campaign['rewardMultiplier'] != null) _chip('${campaign['rewardMultiplier']}x'),
            if (campaign['startAt'] != null) _chip((campaign['startAt'] as String).substring(0, 10)),
            if (campaign['endAt'] != null) _chip('s/d ${(campaign['endAt'] as String).substring(0, 10)}'),
          ]),
          const SizedBox(height: 8),
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            ReLoopButton(label: 'Edit', variant: ReLoopButtonVariant.outline, size: ReLoopButtonSize.sm, expanded: false, onPressed: () => _save(id: id)),
            const SizedBox(width: 8),
            ReLoopButton(label: 'Hapus', variant: ReLoopButtonVariant.ghost, size: ReLoopButtonSize.sm, expanded: false, onPressed: () => _delete(id)),
          ]),
        ]),
      ),
    );
  }

  Widget _chip(String label) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(color: ReLoopColors.background, borderRadius: BorderRadius.circular(6)),
    child: Text(label, style: const TextStyle(fontSize: 10, color: ReLoopColors.muted, fontWeight: FontWeight.w500)),
  );

  String _typeLabel(String t) {
    switch (t) {
      case 'MACHINE_DEPOSIT': return 'Deposit Mesin';
      case 'TRASH_BAG': return 'Trash Bag';
      case 'EVENT': return 'Event';
      case 'SCHOOL_PROGRAM': return 'Sekolah';
      case 'TOURISM_PROGRAM': return 'Wisata';
      default: return t;
    }
  }

  String _statusLabel(String s) {
    switch (s) {
      case 'DRAFT': return 'Draft';
      case 'ACTIVE': return 'Aktif';
      case 'PAUSED': return 'Dijeda';
      case 'ENDED': return 'Berakhir';
      default: return s;
    }
  }

  String _rewardModeLabel(String rewardMode) {
    switch (rewardMode) {
      case 'COMPLIANCE_ONLY':
        return 'Compliance Only';
      case 'MONEY_REWARD':
        return 'Hadiah Uang';
      default:
        return rewardMode;
    }
  }
}
