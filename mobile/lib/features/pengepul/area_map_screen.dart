import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' show LatLng;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../shared/widgets/status_badge.dart';
import '../../theme/colors.dart';

class AreaMapScreen extends StatefulWidget {
  const AreaMapScreen({super.key});

  @override
  State<AreaMapScreen> createState() => _AreaMapScreenState();
}

class _AreaMapScreenState extends State<AreaMapScreen> {
  List<MachineInfo> _machines = [];
  bool _isLoading = true;
  String? _error;
  MachineInfo? _selectedMachine;
  int _onlineCount = 0;
  int _fullCount = 0;

  @override
  void initState() {
    super.initState();
    _loadAreaData();
  }

  Future<void> _loadAreaData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();
      final response = await api.get('/api/pickups/area');
      final data = response.data as Map<String, dynamic>;

      setState(() {
        _machines = (data['machines'] as List? ?? [])
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Area Kerja')),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.cloud_off, size: 48, color: ReLoopColors.mutedSoft),
                      const SizedBox(height: 12),
                      Text(_error!, style: const TextStyle(color: ReLoopColors.muted)),
                      const SizedBox(height: 12),
                      TextButton(onPressed: _loadAreaData, child: const Text('Coba Lagi')),
                    ],
                  ),
                )
              : Stack(
                  children: [
                    FlutterMap(
                      options: MapOptions(
                        initialCenter: _machines.isNotEmpty
                            ? LatLng(
                                _machines.first.latitude!,
                                _machines.first.longitude!,
                              )
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
                              case 'ONLINE': markerColor = ReLoopColors.statusOnline; break;
                              case 'FULL': markerColor = ReLoopColors.statusFull; break;
                              case 'ERROR': markerColor = ReLoopColors.statusError; break;
                              case 'MAINTENANCE': markerColor = ReLoopColors.statusMaintenance; break;
                              default: markerColor = ReLoopColors.statusOffline;
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
                    Positioned(
                      top: 16,
                      left: 16,
                      right: 16,
                      child: _buildStatsBar(),
                    ),
                    if (_selectedMachine != null)
                      Positioned(
                        bottom: 16,
                        left: 16,
                        right: 16,
                        child: _buildMachineCard(),
                      ),
                  ],
                ),
    );
  }

  Widget _buildStatsBar() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: ReLoopColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: ReLoopColors.border),
        boxShadow: const [
          BoxShadow(color: Colors.black12, blurRadius: 8, offset: Offset(0, 2)),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _statItem('Total', '${_machines.length}', ReLoopColors.brand500),
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
          style: const TextStyle(color: ReLoopColors.mutedSoft, fontSize: 11),
        ),
      ],
    );
  }

  Widget _buildMachineCard() {
    final m = _selectedMachine!;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: ReLoopColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: ReLoopColors.border),
        boxShadow: const [
          BoxShadow(color: Colors.black12, blurRadius: 12, offset: Offset(0, 4)),
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
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    color: ReLoopColors.foreground,
                    fontSize: 15,
                  ),
                ),
              ),
              GestureDetector(
                onTap: () => setState(() => _selectedMachine = null),
                child: const Icon(Icons.close, size: 20, color: ReLoopColors.mutedSoft),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            m.machineCode,
            style: const TextStyle(color: ReLoopColors.mutedSoft, fontSize: 12),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              StatusBadge(statusKey: m.status),
              const SizedBox(width: 8),
              if (m.fillLevelPercent > 0)
                Text(
                  'Isi: ${m.fillLevelPercent}%',
                  style: const TextStyle(
                    color: ReLoopColors.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              const Spacer(),
              TextButton.icon(
                onPressed: () => context.push('/machine/${m.machineCode}/detail'),
                icon: const Icon(Icons.info_outline, size: 16),
                label: const Text('Detail', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
