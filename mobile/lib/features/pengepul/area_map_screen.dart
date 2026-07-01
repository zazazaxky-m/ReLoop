import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' show LatLng;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/status_badge.dart';
import '../../theme/colors.dart';

class AreaMapScreen extends StatefulWidget {
  const AreaMapScreen({super.key});

  @override
  State<AreaMapScreen> createState() => _AreaMapScreenState();
}

class _AreaMapScreenState extends State<AreaMapScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

  List<dynamic> _partnerships = [];
  List<dynamic> _organizations = [];
  List<MachineInfo> _machines = [];
  int _onlineCount = 0;
  int _fullCount = 0;
  bool _isLoading = true;
  String? _error;

  MachineInfo? _selectedMachine;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
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
      final results = await Future.wait([
        api.get('/api/partnerships'),
        api.get('/api/organizations'),
        api.get('/api/public/machines', queryParameters: {'scope': 'partners'}),
      ]);

      final partnershipsData = results[0].data as Map<String, dynamic>;
      final orgsData = results[1].data as Map<String, dynamic>;
      final machinesData = results[2].data as Map<String, dynamic>;

      setState(() {
        _partnerships = (partnershipsData['partnerships'] as List? ?? [])
            .cast<dynamic>();
        _organizations = (orgsData['organizations'] as List? ?? [])
            .cast<dynamic>();
        _machines = (machinesData['machines'] as List? ?? [])
            .map((e) => MachineInfo.fromJson(e as Map<String, dynamic>))
            .where((m) => m.latitude != null && m.longitude != null)
            .toList();
        _onlineCount = _machines.where((m) => m.status == 'ONLINE').length;
        _fullCount = _machines.where((m) => m.status == 'FULL').length;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isLoading = false;
      });
    }
  }

  Future<void> _createPartnership(String organizationId) async {
    try {
      final api = context.read<ApiClient>();
      await api.post(
        '/api/partnerships',
        data: {'organizationId': organizationId},
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Permintaan kemitraan dikirim'),
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

  Future<void> _updatePartnership(String id, String action) async {
    try {
      final api = context.read<ApiClient>();
      await api.patch('/api/partnerships/$id', data: {'action': action});
      if (!mounted) return;
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

  Future<void> _saveArea(String id, String regionsText, String noteText) async {
    try {
      final api = context.read<ApiClient>();
      final regions = regionsText
          .split(',')
          .map((s) => s.trim())
          .where((s) => s.isNotEmpty)
          .toList();
      await api.patch(
        '/api/partnerships/$id',
        data: {
          'action': 'set_area',
          'serviceArea': {
            'regions': regions,
            'note': noteText.trim().isEmpty ? null : noteText.trim(),
          },
        },
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Area layanan disimpan'),
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

  void _showCreatePartnership() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Ajukan Kemitraan'),
        content: SizedBox(
          width: double.maxFinite,
          child: ListView(
            shrinkWrap: true,
            children: _organizations.map((o) {
              final org = o as Map<String, dynamic>;
              return ListTile(
                title: Text((org['name'] as String?) ?? ''),
                onTap: () {
                  Navigator.pop(ctx);
                  _createPartnership((org['id'] as String?) ?? '');
                },
              );
            }).toList(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text('Batal')),
        ],
      ),
    );
  }

  void _showAreaEditor(Map<String, dynamic> partnership) {
    final serviceArea = partnership['serviceAreaJson'] as Map<String, dynamic>?;
    final currentRegions =
        (serviceArea?['regions'] as List<dynamic>?)?.join(', ') ?? '';
    final currentNote = (serviceArea?['note'] as String?) ?? '';

    final regionsCtrl = TextEditingController(text: currentRegions);
    final noteCtrl = TextEditingController(text: currentNote);
    final id = (partnership['id'] as String?) ?? '';
    final formKey = GlobalKey<FormState>();

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Atur Area Layanan'),
        content: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: regionsCtrl,
                decoration: const InputDecoration(
                  labelText: 'Wilayah (pisahkan dengan koma)',
                  hintText: 'Kec. A, Kec. B',
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: noteCtrl,
                decoration: const InputDecoration(labelText: 'Catatan'),
                maxLines: 3,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () {
              regionsCtrl.dispose();
              noteCtrl.dispose();
              Navigator.pop(ctx);
            },
            child: Text('Batal'),
          ),
          TextButton(
            onPressed: () {
              final regions = regionsCtrl.text;
              final note = noteCtrl.text;
              regionsCtrl.dispose();
              noteCtrl.dispose();
              Navigator.pop(ctx);
              _saveArea(id, regions, note);
            },
            child: Text('Simpan'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          Container(
            decoration: BoxDecoration(
              color: context.reloopSurface,
              border: Border(
                bottom: BorderSide(color: context.reloopBorder, width: 0.5),
              ),
            ),
            child: TabBar(
              controller: _tabController,
              labelColor: context.isDarkMode
                  ? ReLoopColors.brand400
                  : ReLoopColors.brand600,
              unselectedLabelColor: context.reloopMutedSoft,
              indicatorColor: context.isDarkMode
                  ? ReLoopColors.brand400
                  : ReLoopColors.brand500,
              tabs: const [
                Tab(text: 'Kemitraan'),
                Tab(text: 'Peta Mesin'),
              ],
            ),
          ),
          Expanded(
            child: _isLoading
                ? Center(child: CircularProgressIndicator())
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
                        const SizedBox(height: 12),
                        TextButton(
                          onPressed: _loadAll,
                          child: Text('Coba Lagi'),
                        ),
                      ],
                    ),
                  )
                : TabBarView(
                    controller: _tabController,
                    children: [_buildPartnershipTab(), _buildMapTab()],
                  ),
          ),
        ],
      ),
    );
  }

  // ---- Kemitraan Tab ----

  Widget _buildPartnershipTab() {
    return RefreshIndicator(
      onRefresh: _loadAll,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ReLoopButton(
            label: 'Ajukan Kemitraan',
            icon: Icons.add,
            variant: ReLoopButtonVariant.primary,
            onPressed: _showCreatePartnership,
          ),
          const SizedBox(height: 16),
          if (_partnerships.isEmpty)
            SizedBox(
              height: 120,
              child: Center(
                child: Text(
                  'Belum ada kemitraan.\nAjukan kemitraan dengan organisasi\nuntuk menerima tugas pickup.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: context.reloopMutedSoft,
                    fontSize: 13,
                  ),
                ),
              ),
            )
          else
            ..._partnerships.map((p) {
              final partnership = p as Map<String, dynamic>;
              final org = partnership['organization'] as Map<String, dynamic>?;
              final status = partnership['status'] as String? ?? 'REQUESTED';
              final serviceArea =
                  partnership['serviceAreaJson'] as Map<String, dynamic>?;
              final regions =
                  (serviceArea?['regions'] as List<dynamic>?)?.join(', ') ?? '';
              final note = serviceArea?['note'] as String?;
              final id = (partnership['id'] as String?) ?? '';

              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: ReLoopCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              (org?['name'] as String?) ?? 'Organisasi',
                              style: TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 14,
                                color: context.reloopForeground,
                              ),
                            ),
                          ),
                          StatusBadge(statusKey: status),
                        ],
                      ),
                      if (regions.isNotEmpty) ...[
                        const SizedBox(height: 6),
                        Text(
                          'Wilayah: $regions',
                          style: TextStyle(
                            fontSize: 12,
                            color: context.reloopMutedSoft,
                          ),
                        ),
                      ],
                      if (note != null && note.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          note,
                          style: TextStyle(
                            fontSize: 11,
                            color: context.reloopMutedSoft,
                            fontStyle: FontStyle.italic,
                          ),
                        ),
                      ],
                      if (status == 'INVITED' || status == 'ACTIVE') ...[
                        const SizedBox(height: 10),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            if (status == 'INVITED') ...[
                              ReLoopButton(
                                label: 'Tolak',
                                variant: ReLoopButtonVariant.ghost,
                                size: ReLoopButtonSize.sm,
                                expanded: false,
                                onPressed: () =>
                                    _updatePartnership(id, 'decline'),
                              ),
                              const SizedBox(width: 8),
                              ReLoopButton(
                                label: 'Terima',
                                variant: ReLoopButtonVariant.primary,
                                size: ReLoopButtonSize.sm,
                                expanded: false,
                                onPressed: () =>
                                    _updatePartnership(id, 'accept'),
                              ),
                            ],
                            if (status == 'ACTIVE')
                              ReLoopButton(
                                label: 'Atur Area',
                                variant: ReLoopButtonVariant.outline,
                                size: ReLoopButtonSize.sm,
                                expanded: false,
                                icon: Icons.edit_location_outlined,
                                onPressed: () => _showAreaEditor(partnership),
                              ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }

  // ---- Peta Mesin Tab ----

  Widget _buildMapTab() {
    return Stack(
      children: [
        FlutterMap(
          options: MapOptions(
            initialCenter: _machines.isNotEmpty
                ? LatLng(_machines.first.latitude!, _machines.first.longitude!)
                : const LatLng(-6.2088, 106.8456),
            initialZoom: 13.0,
            onTap: (_, _) => setState(() => _selectedMachine = null),
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'id.reloop.mobile',
            ),
            MarkerLayer(
              markers: _machines.map((m) {
                final isSelected = _selectedMachine?.id == m.id;
                Color markerColor;
                switch (m.status) {
                  case 'ONLINE':
                    markerColor = ReLoopColors.statusOnline;
                    break;
                  case 'FULL':
                    markerColor = ReLoopColors.statusFull;
                    break;
                  case 'ERROR':
                    markerColor = ReLoopColors.statusError;
                    break;
                  case 'MAINTENANCE':
                    markerColor = ReLoopColors.statusMaintenance;
                    break;
                  default:
                    markerColor = ReLoopColors.statusOffline;
                }
                return Marker(
                  point: LatLng(m.latitude!, m.longitude!),
                  width: isSelected ? 44 : 36,
                  height: isSelected ? 44 : 36,
                  child: GestureDetector(
                    onTap: () => setState(() => _selectedMachine = m),
                    child: Container(
                      decoration: BoxDecoration(
                        color: markerColor,
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: Colors.white,
                          width: isSelected ? 3 : 2,
                        ),
                        boxShadow: const [
                          BoxShadow(
                            color: Colors.black26,
                            blurRadius: 4,
                            offset: Offset(0, 2),
                          ),
                        ],
                      ),
                      child: const Icon(
                        Icons.recycling,
                        color: Colors.white,
                        size: 18,
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ],
        ),
        Positioned(top: 16, left: 16, right: 16, child: _buildStatsBar()),
        if (_selectedMachine != null)
          Positioned(
            bottom: 16,
            left: 16,
            right: 16,
            child: _buildMachineCard(),
          ),
      ],
    );
  }

  Widget _buildStatsBar() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.reloopSurfaceRaised,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: context.reloopBorder),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(
              alpha: context.isDarkMode ? .3 : .08,
            ),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _statItem(
            'Total',
            '${_machines.length}',
            context.isDarkMode ? ReLoopColors.brand400 : ReLoopColors.brand500,
          ),
          _statItem('Online', '$_onlineCount', ReLoopColors.statusOnline),
          _statItem('Penuh', '$_fullCount', ReLoopColors.statusFull),
        ],
      ),
    );
  }

  Widget _statItem(String label, String value, Color color) {
    return Column(
      children: [
        Text(
          value,
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: color,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: TextStyle(color: context.reloopMutedSoft, fontSize: 11),
        ),
      ],
    );
  }

  Widget _buildMachineCard() {
    final m = _selectedMachine;
    if (m == null) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: context.reloopSurfaceRaised,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: context.reloopBorder),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(
              alpha: context.isDarkMode ? .3 : .08,
            ),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  m.name,
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: context.reloopForeground,
                    fontSize: 15,
                  ),
                ),
              ),
              GestureDetector(
                onTap: () => setState(() => _selectedMachine = null),
                child: Icon(
                  Icons.close,
                  size: 20,
                  color: context.reloopMutedSoft,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            m.machineCode,
            style: TextStyle(color: context.reloopMutedSoft, fontSize: 12),
          ),
          if (m.organizationName != null) ...[
            const SizedBox(height: 2),
            Text(
              m.organizationName!,
              style: TextStyle(color: context.reloopMutedSoft, fontSize: 12),
            ),
          ],
          const SizedBox(height: 8),
          Row(
            children: [
              StatusBadge(statusKey: m.status),
              const SizedBox(width: 8),
              if (m.fillLevelPercent > 0)
                Text(
                  'Isi: ${m.fillLevelPercent}%',
                  style: TextStyle(
                    color: context.reloopMuted,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              const Spacer(),
              TextButton.icon(
                onPressed: () =>
                    context.push('/machine/${m.machineCode}/detail'),
                icon: const Icon(Icons.info_outline, size: 16),
                label: Text('Detail', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
