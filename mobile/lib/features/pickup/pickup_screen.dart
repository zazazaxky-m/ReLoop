import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/auth_provider.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';

class PickupScreen extends StatefulWidget {
  const PickupScreen({super.key});

  @override
  State<PickupScreen> createState() => _PickupScreenState();
}

class _PickupScreenState extends State<PickupScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  List<dynamic> _pickups = [];
  List<dynamic> _availablePickups = [];
  List<dynamic> _wasteTypes = [];
  bool _isLoading = true;
  String? _error;

  final Map<String, bool> _expandedForms = {};
  final Map<String, dynamic> _materialForms = {};

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadAll();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadAll() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();
      final auth = context.read<AuthProvider>();

      final queryParams = <String, String>{};
      if (auth.user?.role == AppRole.PENGEPUL) {
        queryParams['scope'] = 'collector';
      }

      final futures = <Future<dynamic>>[
        api.get('/api/pickups', queryParameters: queryParams),
        api.get('/api/waste-types'),
      ];
      if (auth.user?.role == AppRole.PENGEPUL) {
        futures.add(
          api.get('/api/pickups', queryParameters: {'scope': 'available'}),
        );
      }

      final results = await Future.wait(futures);

      final pickupsData = results[0].data as Map<String, dynamic>;
      final wasteData = results[1].data as Map<String, dynamic>;
      final availableData = results.length > 2
          ? results[2].data as Map<String, dynamic>
          : null;

      setState(() {
        _pickups = (pickupsData['pickups'] as List? ?? []).cast<dynamic>();
        _wasteTypes = (wasteData['wasteTypes'] as List? ?? []).cast<dynamic>();
        if (availableData != null) {
          _availablePickups = (availableData['pickups'] as List? ?? [])
              .cast<dynamic>();
        }
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isLoading = false;
      });
    }
  }

  Future<void> _updatePickupStatus(
    String pickupId,
    String action, {
    String? notes,
  }) async {
    try {
      final api = context.read<ApiClient>();
      final body = <String, dynamic>{'action': action};
      if (notes != null) body['notes'] = notes;
      await api.patch('/api/pickups/$pickupId', data: body);
      await _loadAll();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ApiClient.getErrorMessage(e)),
            backgroundColor: ReLoopColors.danger,
          ),
        );
      }
    }
  }

  Future<void> _recordMaterial(String pickupId) async {
    final form = _materialForms[pickupId];
    if (form == null) return;

    final wasteTypeId = form['wasteTypeId'] as String?;
    final itemCountStr = (form['itemCount'] as String?) ?? '';
    final weightStr = (form['weight'] as String?) ?? '';
    final notes = (form['notes'] as String?) ?? '';

    try {
      final api = context.read<ApiClient>();
      await api.post(
        '/api/pickups/$pickupId/items',
        data: {
          if (wasteTypeId != null && wasteTypeId.isNotEmpty)
            'wasteTypeId': wasteTypeId,
          if (itemCountStr.isNotEmpty) 'itemCount': int.parse(itemCountStr),
          if (weightStr.isNotEmpty) 'actualWeightKg': double.parse(weightStr),
          'source': 'MANUAL_WEIGHING',
          if (notes.isNotEmpty) 'notes': notes,
        },
      );
      if (!mounted) return;

      _materialForms.remove(pickupId);
      _expandedForms.remove(pickupId);

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Material berhasil dicatat'),
          backgroundColor: ReLoopColors.success,
        ),
      );

      await _loadAll();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ApiClient.getErrorMessage(e)),
            backgroundColor: ReLoopColors.danger,
          ),
        );
      }
    }
  }

  Future<void> _confirmFail(String pickupId) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Gagalkan Pickup?'),
        content: Text(
          'Apakah Anda yakin ingin menandai pickup ini sebagai gagal?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('Batal'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: ReLoopColors.danger),
            child: Text('Ya, Gagalkan'),
          ),
        ],
      ),
    );

    if (confirm == true && mounted) {
      await _updatePickupStatus(pickupId, 'fail');
    }
  }

  void _toggleMaterialForm(String pickupId) {
    setState(() {
      if (_expandedForms[pickupId] == true) {
        _expandedForms.remove(pickupId);
        _materialForms.remove(pickupId);
      } else {
        _expandedForms[pickupId] = true;
        _materialForms[pickupId] = {
          'wasteTypeId': null,
          'itemCount': '',
          'weight': '',
          'notes': '',
        };
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final isCollector = auth.user?.role == AppRole.PENGEPUL;

    return Scaffold(
      body: Column(
        children: [
          Container(
            decoration: const BoxDecoration(
              color: context.reloopSurface,
              border: Border(
                bottom: BorderSide(color: context.reloopBorder, width: 0.5),
              ),
            ),
            child: TabBar(
              controller: _tabController,
              labelColor: ReLoopColors.brand600,
              unselectedLabelColor: ReLoopColors.mutedSoft,
              indicatorColor: ReLoopColors.brand500,
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              tabs: const [
                Tab(text: 'Tugas Aktif'),
                Tab(text: 'Tersedia'),
                Tab(text: 'Selesai/Gagal'),
              ],
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _loadAll,
              child: _buildBody(isCollector),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(bool isCollector) {
    if (_isLoading) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          SkeletonListTile(),
          SizedBox(height: 8),
          SkeletonListTile(),
          SizedBox(height: 8),
          SkeletonListTile(),
        ],
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off, size: 48, color: context.reloopMutedSoft),
            const SizedBox(height: 12),
            Text(_error!, style: TextStyle(color: context.reloopMuted)),
            const SizedBox(height: 12),
            TextButton(onPressed: _loadAll, child: Text('Coba Lagi')),
          ],
        ),
      );
    }

    final activeTasks = _pickups.where((p) {
      final s = (p as Map)['status'] as String?;
      return !['COMPLETED', 'CANCELLED', 'FAILED'].contains(s);
    }).toList();

    final doneTasks = _pickups.where((p) {
      final s = (p as Map)['status'] as String?;
      return ['COMPLETED', 'CANCELLED', 'FAILED'].contains(s);
    }).toList();

    return TabBarView(
      controller: _tabController,
      children: [
        _buildList(
          activeTasks,
          isCollector,
          emptyMessage: 'Tidak ada tugas aktif',
        ),
        _buildList(
          _availablePickups,
          isCollector,
          emptyMessage: 'Tidak ada tugas baru dari mitra',
          isAvailableTasks: true,
        ),
        _buildList(
          doneTasks,
          isCollector,
          emptyMessage: 'Tidak ada riwayat tugas',
        ),
      ],
    );
  }

  Widget _buildList(
    List<dynamic> list,
    bool isCollector, {
    required String emptyMessage,
    bool isAvailableTasks = false,
  }) {
    if (list.isEmpty) {
      return ListView(
        children: [
          SizedBox(
            height: 200,
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.local_shipping_outlined,
                    size: 48,
                    color: context.reloopMutedSoft,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    emptyMessage,
                    style: TextStyle(
                      color: context.reloopMutedSoft,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      );
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: list
          .map(
            (p) => _buildPickupCard(
              p,
              isCollector,
              isAvailableTasks: isAvailableTasks,
            ),
          )
          .toList(),
    );
  }

  Widget _buildPickupCard(
    dynamic p,
    bool isCollector, {
    bool isAvailableTasks = false,
  }) {
    final pickup = p as Map<String, dynamic>;
    final machine = pickup['machine'] as Map<String, dynamic>?;
    final org = pickup['organization'] as Map<String, dynamic>?;
    final status = pickup['status'] as String? ?? 'REQUESTED';
    final reason = pickup['reason'] as String? ?? 'MANUAL';
    final priority = (pickup['priority'] as num?)?.toInt() ?? 0;
    final itemCount = (pickup['_count']?['items'] as num?)?.toInt() ?? 0;
    final recordedItems = pickup['items'] as List<dynamic>? ?? [];
    final pickupId = (pickup['id'] as String?) ?? '';
    final isFormExpanded = _expandedForms[pickupId] == true;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: ReLoopCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: ReLoopColors.mintSoft,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(
                    Icons.local_shipping,
                    color: ReLoopColors.brand500,
                    size: 22,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        machine?['name'] as String? ??
                            'Mesin #${pickup['machineId']}',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: context.reloopForeground,
                          fontSize: 14,
                        ),
                      ),
                      if (machine?['machineCode'] != null)
                        Text(
                          'Kode: ${machine!['machineCode']}',
                          style: TextStyle(
                            color: context.reloopMutedSoft,
                            fontSize: 11,
                          ),
                        ),
                      if (org != null)
                        Text(
                          org['name'] as String? ?? '',
                          style: TextStyle(
                            color: context.reloopMutedSoft,
                            fontSize: 12,
                          ),
                        ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    StatusBadge(statusKey: status),
                    if (priority > 0)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: ReLoopColors.statusError.withValues(
                              alpha: 0.1,
                            ),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            'P$priority',
                            style: const TextStyle(
                              color: ReLoopColors.statusError,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ],
            ),
            if (org?['contactName'] != null ||
                org?['contactPhone'] != null ||
                org?['address'] != null) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: ReLoopColors.background,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (org?['contactName'] != null)
                      Text(
                        org!['contactName'] as String,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: context.reloopForeground,
                        ),
                      ),
                    if (org?['contactPhone'] != null)
                      Text(
                        org!['contactPhone'] as String,
                        style: TextStyle(
                          fontSize: 11,
                          color: context.reloopMutedSoft,
                        ),
                      ),
                    if (org?['address'] != null)
                      Text(
                        org!['address'] as String,
                        style: TextStyle(
                          fontSize: 11,
                          color: context.reloopMutedSoft,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 10),
            Row(
              children: [
                _pickupChip(Icons.info_outline, _reasonLabel(reason)),
                const SizedBox(width: 6),
                _pickupChip(Icons.inventory_2, '$itemCount material'),
                if (machine?['fillLevelPercent'] != null) ...[
                  const SizedBox(width: 6),
                  _pickupChip(
                    Icons.water_drop,
                    '${machine!['fillLevelPercent']}% penuh',
                  ),
                ],
              ],
            ),

            if (recordedItems.isNotEmpty) ...[
              const SizedBox(height: 10),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: ReLoopColors.brand50,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: ReLoopColors.brand100),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Material tercatat:',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: ReLoopColors.brand700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    ...recordedItems.map((item) {
                      final i = item as Map<String, dynamic>;
                      final wtName = i['wasteType']?['name'] as String?;
                      final count = i['itemCount'] as num?;
                      final weight = i['actualWeightKg'] as num?;
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 2),
                        child: Text(
                          '${wtName ?? "Item"} — ${count ?? "-"} pcs, ${weight ?? "-"} kg',
                          style: const TextStyle(
                            fontSize: 11,
                            color: ReLoopColors.brand600,
                          ),
                        ),
                      );
                    }),
                  ],
                ),
              ),
            ],

            if (isAvailableTasks) ...[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: ReLoopButton(
                  label: 'Ambil Tugas Ini',
                  icon: Icons.front_hand,
                  variant: ReLoopButtonVariant.primary,
                  onPressed: () => _updatePickupStatus(pickupId, 'assign'),
                ),
              ),
            ] else if (isCollector) ...[
              const SizedBox(height: 12),
              _buildActionButtons(pickupId, status, isFormExpanded),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildActionButtons(
    String pickupId,
    String status,
    bool isFormExpanded,
  ) {
    return Column(
      children: [
        Row(
          children: [
            if (status == 'ASSIGNED')
              Expanded(
                child: ReLoopButton(
                  label: 'Mulai Perjalanan',
                  icon: Icons.play_arrow,
                  variant: ReLoopButtonVariant.primary,
                  size: ReLoopButtonSize.sm,
                  onPressed: () => _updatePickupStatus(pickupId, 'start'),
                ),
              ),
            if (status == 'ON_THE_WAY') ...[
              Expanded(
                child: ReLoopButton(
                  label: 'Tiba',
                  icon: Icons.location_on,
                  variant: ReLoopButtonVariant.primary,
                  size: ReLoopButtonSize.sm,
                  onPressed: () => _updatePickupStatus(pickupId, 'arrive'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: ReLoopButton(
                  label: 'Gagal',
                  icon: Icons.cancel_outlined,
                  variant: ReLoopButtonVariant.danger,
                  size: ReLoopButtonSize.sm,
                  onPressed: () => _confirmFail(pickupId),
                ),
              ),
            ],
            if (status == 'ARRIVED') ...[
              Expanded(
                child: ReLoopButton(
                  label: 'Ambil Sampah',
                  icon: Icons.inventory_2,
                  variant: ReLoopButtonVariant.primary,
                  size: ReLoopButtonSize.sm,
                  onPressed: () => _updatePickupStatus(pickupId, 'collect'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: ReLoopButton(
                  label: 'Gagal',
                  icon: Icons.cancel_outlined,
                  variant: ReLoopButtonVariant.danger,
                  size: ReLoopButtonSize.sm,
                  onPressed: () => _confirmFail(pickupId),
                ),
              ),
            ],
            if (status == 'COLLECTED') ...[
              Expanded(
                child: ReLoopButton(
                  label: 'Selesai',
                  icon: Icons.check,
                  variant: ReLoopButtonVariant.primary,
                  size: ReLoopButtonSize.sm,
                  onPressed: () => _updatePickupStatus(pickupId, 'complete'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: ReLoopButton(
                  label: 'Gagal',
                  icon: Icons.cancel_outlined,
                  variant: ReLoopButtonVariant.danger,
                  size: ReLoopButtonSize.sm,
                  onPressed: () => _confirmFail(pickupId),
                ),
              ),
            ],
            if (status == 'ASSIGNED') ...[
              const SizedBox(width: 8),
              Expanded(
                child: ReLoopButton(
                  label: 'Gagal',
                  icon: Icons.cancel_outlined,
                  variant: ReLoopButtonVariant.danger,
                  size: ReLoopButtonSize.sm,
                  onPressed: () => _confirmFail(pickupId),
                ),
              ),
            ],
          ],
        ),
        if (status == 'ARRIVED' || status == 'COLLECTED') ...[
          const SizedBox(height: 8),
          ReLoopButton(
            label: isFormExpanded ? 'Tutup Form Material' : 'Catat Material',
            icon: isFormExpanded ? Icons.expand_less : Icons.add_box_outlined,
            variant: ReLoopButtonVariant.outline,
            size: ReLoopButtonSize.sm,
            onPressed: () => _toggleMaterialForm(pickupId),
          ),
          if (isFormExpanded) _buildMaterialForm(pickupId),
        ],
      ],
    );
  }

  Widget _buildMaterialForm(String pickupId) {
    final form = _materialForms[pickupId];
    if (form == null) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: ReLoopColors.background,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: context.reloopBorder),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Catat Material',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: context.reloopForeground,
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: ValueKey('wasteType-$pickupId-${form['wasteTypeId'] ?? ''}'),
              initialValue: form['wasteTypeId'] as String?,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Jenis Material',
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
              ),
              items: [
                DropdownMenuItem<String>(
                  value: null,
                  child: Text(
                    'Pilih jenis...',
                    style: TextStyle(color: context.reloopMutedSoft),
                  ),
                ),
                ..._wasteTypes.map((wt) {
                  final w = wt as Map<String, dynamic>;
                  return DropdownMenuItem<String>(
                    value: (w['id'] as String?) ?? '',
                    child: Text((w['name'] as String?) ?? ''),
                  );
                }),
              ],
              onChanged: (v) {
                setState(() => form['wasteTypeId'] = v);
              },
            ),
            const SizedBox(height: 10),
            TextFormField(
              initialValue: form['itemCount'] as String?,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Jumlah (pcs)',
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
              ),
              onChanged: (v) {
                setState(() => form['itemCount'] = v);
              },
            ),
            const SizedBox(height: 10),
            TextFormField(
              initialValue: form['weight'] as String?,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                labelText: 'Berat aktual (kg)',
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
              ),
              onChanged: (v) {
                setState(() => form['weight'] = v);
              },
            ),
            const SizedBox(height: 10),
            TextFormField(
              initialValue: form['notes'] as String?,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Catatan',
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
              ),
              onChanged: (v) {
                setState(() => form['notes'] = v);
              },
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: ReLoopButton(
                    label: 'Simpan Material',
                    icon: Icons.save_outlined,
                    variant: ReLoopButtonVariant.primary,
                    size: ReLoopButtonSize.sm,
                    onPressed: () => _recordMaterial(pickupId),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ReLoopButton(
                    label: 'Batal',
                    variant: ReLoopButtonVariant.outline,
                    size: ReLoopButtonSize.sm,
                    onPressed: () => _toggleMaterialForm(pickupId),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _pickupChip(IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: ReLoopColors.background,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: ReLoopColors.mutedSoft),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              color: context.reloopMuted,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  String _reasonLabel(String reason) {
    switch (reason) {
      case 'FULL':
        return 'Penuh';
      case 'SCHEDULED':
        return 'Terjadwal';
      case 'MANUAL':
        return 'Manual';
      case 'ERROR':
        return 'Error';
      default:
        return reason;
    }
  }
}
