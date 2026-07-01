import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'admin_shell.dart';

class AdminWasteTypesScreen extends StatefulWidget {
  const AdminWasteTypesScreen({super.key});
  @override
  State<AdminWasteTypesScreen> createState() => _AdminWasteTypesScreenState();
}

class _AdminWasteTypesScreenState extends State<AdminWasteTypesScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<dynamic> _wasteTypes = [];
  List<dynamic> _rates = [];
  List<dynamic> _campaigns = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiClient>();
      final results = await Future.wait([
        api.get('/api/waste-types'),
        api.get('/api/reward-rates'),
        api.get('/api/campaigns'),
      ]);
      setState(() {
        _wasteTypes =
            ((results[0].data as Map)['wasteTypes'] as List?)
                ?.cast<dynamic>() ??
            [];
        _rates =
            ((results[1].data as Map)['rates'] as List?)?.cast<dynamic>() ?? [];
        _campaigns =
            ((results[2].data as Map)['campaigns'] as List?)?.cast<dynamic>() ??
            [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isLoading = false;
      });
    }
  }

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: ReLoopColors.danger),
    );
  }

  // ---- Waste Type CRUD ----

  Future<void> _saveWasteType({String? id}) async {
    final isEdit = id != null;
    final existing = isEdit
        ? _wasteTypes.firstWhere((w) => w['id'] == id) as Map<String, dynamic>
        : null;

    final nameCtrl = TextEditingController(text: existing?['name'] ?? '');
    String unit = existing?['unit'] ?? 'ITEM';
    final minCtrl = TextEditingController(
      text: existing?['minWeightGrams']?.toString() ?? '',
    );
    final maxCtrl = TextEditingController(
      text: existing?['maxWeightGrams']?.toString() ?? '',
    );
    final rewardCtrl = TextEditingController(
      text: existing?['defaultRewardPerItem']?.toString() ?? '',
    );
    final descCtrl = TextEditingController(
      text: existing?['description'] ?? '',
    );

    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: Text(isEdit ? 'Edit Jenis Sampah' : 'Jenis Sampah Baru'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: nameCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Nama',
                    hintText: 'wajib',
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: unit,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Unit'),
                  items: const [
                    DropdownMenuItem(
                      value: 'ITEM',
                      child: Text('ITEM (per pcs)'),
                    ),
                    DropdownMenuItem(value: 'KG', child: Text('KG (timbang)')),
                  ],
                  onChanged: (v) => setSt(() => unit = v ?? 'ITEM'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: minCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Berat min (gram)',
                  ),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: maxCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Berat max (gram)',
                  ),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: rewardCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Default reward (Rp)',
                  ),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: descCtrl,
                  decoration: const InputDecoration(labelText: 'Deskripsi'),
                  maxLines: 2,
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
                'name': nameCtrl.text.trim(),
                'unit': unit,
                'minWeightGrams': int.tryParse(minCtrl.text),
                'maxWeightGrams': int.tryParse(maxCtrl.text),
                'defaultRewardPerItem': int.tryParse(rewardCtrl.text),
                'description': descCtrl.text.trim().isEmpty
                    ? null
                    : descCtrl.text.trim(),
              }),
              child: Text('Simpan'),
            ),
          ],
        ),
      ),
    );
    if (result == null ||
        (result['name'] as String?)?.isEmpty == true ||
        !mounted) {
      return;
    }
    try {
      final api = context.read<ApiClient>();
      if (isEdit) {
        await api.patch('/api/waste-types/$id', data: result);
      } else {
        await api.post('/api/waste-types', data: result);
      }
      await _load();
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  Future<void> _toggleWasteType(dynamic wt) async {
    final id = wt['id'] as String;
    final active = wt['active'] as bool? ?? true;
    try {
      await context.read<ApiClient>().patch(
        '/api/waste-types/$id',
        data: {'active': !active},
      );
      await _load();
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  Future<void> _deleteWasteType(String id, String name) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Nonaktifkan Jenis Sampah?'),
        content: Text('"$name" akan dinonaktifkan.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('Batal'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(
              'Nonaktifkan',
              style: TextStyle(color: ReLoopColors.danger),
            ),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await context.read<ApiClient>().delete('/api/waste-types/$id');
      await _load();
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  // ---- Reward Rate CRUD ----

  Future<void> _saveRate() async {
    final activeWasteTypes = _wasteTypes
        .where((w) => w['active'] == true)
        .toList();
    String wasteTypeId =
        (activeWasteTypes.isNotEmpty ? activeWasteTypes[0]['id'] : null)
            as String? ??
        '';
    final pointsCtrl = TextEditingController();
    final minWeightCtrl = TextEditingController();
    final maxWeightCtrl = TextEditingController();
    String unit = 'ITEM';
    String? campaignId;

    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSt) => AlertDialog(
          title: Text('Tarif Baru'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  value: wasteTypeId,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Jenis Sampah'),
                  items: _wasteTypes
                      .where((w) => w['active'] == true)
                      .map(
                        (w) => DropdownMenuItem(
                          value: (w['id'] as String?) ?? '',
                          child: Text((w['name'] as String?) ?? ''),
                        ),
                      )
                      .toList(),
                  onChanged: (v) => setSt(() => wasteTypeId = v ?? ''),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: pointsCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Poin per unit',
                    hintText: 'wajib',
                  ),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  value: unit,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Unit'),
                  items: const [
                    DropdownMenuItem(
                      value: 'ITEM',
                      child: Text('ITEM (per pcs)'),
                    ),
                    DropdownMenuItem(
                      value: 'KG',
                      child: Text('KG (per kilogram)'),
                    ),
                  ],
                  onChanged: (v) => setSt(() => unit = v ?? 'ITEM'),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: minWeightCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Berat Min (Gram)',
                    hintText: 'opsional',
                  ),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: maxWeightCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Berat Max (Gram)',
                    hintText: 'opsional',
                  ),
                  keyboardType: TextInputType.number,
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String?>(
                  value: campaignId,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'Scope Campaign',
                  ),
                  items: [
                    DropdownMenuItem(
                      value: null,
                      child: Text('Global / Organisasi'),
                    ),
                    ..._campaigns.map(
                      (c) => DropdownMenuItem(
                        value: c['id'] as String?,
                        child: Text(c['name'] as String? ?? ''),
                      ),
                    ),
                  ],
                  onChanged: (v) => setSt(() => campaignId = v),
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
              onPressed: () {
                final points = int.tryParse(pointsCtrl.text) ?? 0;
                final minW = int.tryParse(minWeightCtrl.text);
                final maxW = int.tryParse(maxWeightCtrl.text);

                Navigator.pop(ctx, {
                  'wasteTypeId': wasteTypeId,
                  'pointsPerItem': points,
                  'unit': unit,
                  'minWeightGrams': minW,
                  'maxWeightGrams': maxW,
                  'campaignId': campaignId,
                });
              },
              child: Text('Simpan'),
            ),
          ],
        ),
      ),
    );
    if (result == null || result['wasteTypeId'] == null || !mounted) return;
    try {
      await context.read<ApiClient>().post('/api/reward-rates', data: result);
      await _load();
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  Future<void> _toggleRate(dynamic r) async {
    final id = r['id'] as String;
    try {
      await context.read<ApiClient>().patch('/api/reward-rates/$id', data: {});
      await _load();
    } catch (e) {
      if (mounted) _showError(ApiClient.getErrorMessage(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AdminShell(
      title: 'Jenis Sampah & Tarif',
      child: Column(
        children: [
          TabBar(
            controller: _tabController,
            labelColor: context.reloopBrandText,
            unselectedLabelColor: context.reloopMutedSoft,
            indicatorColor: ReLoopColors.brand500,
            tabs: const [
              Tab(text: 'Jenis Sampah'),
              Tab(text: 'Tarif Reward'),
            ],
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _load,
              child: _isLoading
                  ? ListView(
                      padding: const EdgeInsets.all(16),
                      children: const [
                        SkeletonListTile(),
                        SizedBox(height: 8),
                        SkeletonListTile(),
                      ],
                    )
                  : _error != null
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.cloud_off,
                            size: 48,
                            color: context.reloopMutedSoft,
                          ),
                          const SizedBox(height: 12),
                          Text(
                            _error ?? '',
                            style: TextStyle(color: context.reloopMuted),
                          ),
                          TextButton(
                            onPressed: _load,
                            child: Text('Coba Lagi'),
                          ),
                        ],
                      ),
                    )
                  : TabBarView(
                      controller: _tabController,
                      children: [_buildWasteTypes(), _buildRates()],
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWasteTypes() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ReLoopButton(
          label: 'Tambah Jenis',
          icon: Icons.add,
          variant: ReLoopButtonVariant.primary,
          onPressed: () => _saveWasteType(),
        ),
        const SizedBox(height: 16),
        if (_wasteTypes.isEmpty)
          SizedBox(
            height: 120,
            child: Center(
              child: Text(
                'Belum ada jenis sampah.',
                style: TextStyle(color: context.reloopMutedSoft),
              ),
            ),
          )
        else
          ..._wasteTypes.map((w) {
            final wt = w as Map<String, dynamic>;
            final active = wt['active'] as bool? ?? true;
            final reward = wt['defaultRewardPerItem'] as num?;
            final minW = wt['minWeightGrams'] as num?;
            final maxW = wt['maxWeightGrams'] as num?;
            final orgId = wt['organizationId'] as String?;
            final id = wt['id'] as String? ?? '';
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ReLoopCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                (wt['name'] as String?) ?? '',
                                style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 14,
                                  color: context.reloopForeground,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                [
                                  if (wt['unit'] != null) wt['unit'],
                                  if (reward != null) 'Rp$reward/item',
                                  if (minW != null || maxW != null)
                                    '${minW ?? '-'}-${maxW ?? '-'}g',
                                  orgId == null ? 'Global' : 'Organisasi',
                                ].join(' · '),
                                style: TextStyle(
                                  fontSize: 11,
                                  color: context.reloopMutedSoft,
                                ),
                              ),
                            ],
                          ),
                        ),
                        StatusBadge(statusKey: active ? 'ACTIVE' : 'REJECTED'),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        ReLoopButton(
                          label: 'Edit',
                          variant: ReLoopButtonVariant.outline,
                          size: ReLoopButtonSize.sm,
                          expanded: false,
                          onPressed: () => _saveWasteType(id: id),
                        ),
                        const SizedBox(width: 8),
                        ReLoopButton(
                          label: active ? 'Nonaktif' : 'Aktif',
                          variant: ReLoopButtonVariant.ghost,
                          size: ReLoopButtonSize.sm,
                          expanded: false,
                          onPressed: () => _toggleWasteType(wt),
                        ),
                        if (orgId != null) ...[
                          const SizedBox(width: 8),
                          ReLoopButton(
                            label: 'Hapus',
                            variant: ReLoopButtonVariant.ghost,
                            size: ReLoopButtonSize.sm,
                            expanded: false,
                            onPressed: () => _deleteWasteType(
                              id,
                              wt['name'] as String? ?? '',
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            );
          }),
      ],
    );
  }

  Widget _buildRates() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ReLoopButton(
          label: 'Tambah Tarif',
          icon: Icons.add,
          variant: ReLoopButtonVariant.primary,
          onPressed: () => _saveRate(),
        ),
        const SizedBox(height: 16),
        if (_rates.isEmpty)
          SizedBox(
            height: 120,
            child: Center(
              child: Text(
                'Belum ada tarif.',
                style: TextStyle(color: context.reloopMutedSoft),
              ),
            ),
          )
        else
          ..._rates.map((r) {
            final rate = r as Map<String, dynamic>;
            final wt = rate['wasteType'] as Map<String, dynamic>?;
            final org = rate['organization'] as Map<String, dynamic>?;
            final campaign = rate['campaign'] as Map<String, dynamic>?;
            final active = rate['active'] as bool? ?? true;
            final minW = rate['minWeightGrams'] as num?;
            final maxW = rate['maxWeightGrams'] as num?;
            final effFrom = rate['effectiveFrom'] as String?;
            final effTo = rate['effectiveTo'] as String?;

            String scope = 'Global';
            if (campaign != null) {
              scope = 'Campaign: ${campaign['name']}';
            } else if (org != null) {
              scope = org['name'] as String? ?? '';
            }

            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: ReLoopCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                (wt?['name'] as String?) ?? '',
                                style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  fontSize: 14,
                                  color: context.reloopForeground,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                [
                                  '${rate['pointsPerItem']} poin',
                                  scope,
                                  if (minW != null || maxW != null)
                                    '${minW ?? '-'}-${maxW ?? '-'}g',
                                  if (effFrom != null)
                                    'dari ${(effFrom).substring(0, 10)}',
                                  if (effTo != null)
                                    's/d ${(effTo).substring(0, 10)}',
                                ].join(' · '),
                                style: TextStyle(
                                  fontSize: 11,
                                  color: context.reloopMutedSoft,
                                ),
                              ),
                            ],
                          ),
                        ),
                        StatusBadge(statusKey: active ? 'ACTIVE' : 'REJECTED'),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        if (active)
                          ReLoopButton(
                            label: 'Nonaktifkan',
                            variant: ReLoopButtonVariant.ghost,
                            size: ReLoopButtonSize.sm,
                            expanded: false,
                            onPressed: () => _toggleRate(rate),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          }),
      ],
    );
  }
}
