import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' show LatLng;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  List<MachineInfo> _machines = [];
  bool _isLoading = true;
  String? _error;
  MachineInfo? _selectedMachine;

  @override
  void initState() {
    super.initState();
    _loadMachines();
  }

  Future<void> _loadMachines() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();
      // Try the public display endpoint list or machines API
      final response = await api.get('/api/machines');
      final data = response.data as Map<String, dynamic>;
      setState(() {
        _machines = (data['machines'] as List? ?? [])
            .map((e) => MachineInfo.fromJson(e as Map<String, dynamic>))
            .where((m) => m.latitude != null && m.longitude != null)
            .toList();
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
      appBar: AppBar(title: const Text('Peta Mesin')),
      body: _isLoading
          ? const SkeletonDashboard()
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.cloud_off, size: 48, color: ReLoopColors.mutedSoft),
                      const SizedBox(height: 12),
                      Text(_error!,
                          style: const TextStyle(color: ReLoopColors.muted)),
                      const SizedBox(height: 12),
                      TextButton(
                          onPressed: _loadMachines,
                          child: const Text('Coba Lagi')),
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
                            : const LatLng(-6.2088, 106.8456), // Jakarta
                        initialZoom: 13.0,
                        onTap: (_, _) {
                          setState(() => _selectedMachine = null);
                        },
                      ),
                      children: [
                        TileLayer(
                          urlTemplate:
                              'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                          userAgentPackageName: 'id.reloop.mobile',
                        ),
                        MarkerLayer(
                          markers: _machines.map((m) {
                            final isSelected = _selectedMachine?.id == m.id;
                            Color markerColor;
                            switch (m.status) {
                              case 'ONLINE':
                                markerColor = ReLoopColors.statusOnline;
                              case 'FULL':
                                markerColor = ReLoopColors.statusFull;
                              case 'ERROR':
                                markerColor = ReLoopColors.statusError;
                              case 'MAINTENANCE':
                                markerColor = ReLoopColors.statusMaintenance;
                              default:
                                markerColor = ReLoopColors.statusOffline;
                            }
                            return Marker(
                              point: LatLng(m.latitude!, m.longitude!),
                              width: isSelected ? 44 : 36,
                              height: isSelected ? 44 : 36,
                              child: GestureDetector(
                                onTap: () {
                                  setState(() => _selectedMachine = m);
                                },
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
                    if (_selectedMachine != null)
                      Positioned(
                        bottom: 16,
                        left: 16,
                        right: 16,
                        child: _MachineInfoCard(
                          machine: _selectedMachine!,
                          onClose: () =>
                              setState(() => _selectedMachine = null),
                        ),
                      ),
                  ],
                ),
    );
  }
}

class _MachineInfoCard extends StatelessWidget {
  final MachineInfo machine;
  final VoidCallback onClose;

  const _MachineInfoCard({
    required this.machine,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: ReLoopColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: ReLoopColors.border),
        boxShadow: const [
          BoxShadow(
            color: Colors.black12,
            blurRadius: 12,
            offset: Offset(0, 4),
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
                  machine.name,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    color: ReLoopColors.foreground,
                    fontSize: 15,
                  ),
                ),
              ),
              GestureDetector(
                onTap: onClose,
                child: const Icon(Icons.close, size: 20, color: ReLoopColors.mutedSoft),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            machine.machineCode,
            style: const TextStyle(color: ReLoopColors.mutedSoft, fontSize: 12),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              StatusBadge(statusKey: machine.status),
              const SizedBox(width: 8),
              if (machine.fillLevelPercent > 0)
                Text(
                  'Isi: ${machine.fillLevelPercent}%',
                  style: const TextStyle(
                    color: ReLoopColors.muted,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const Spacer(),
                TextButton.icon(
                  onPressed: () =>
                      context.push('/machine/${machine.machineCode}/detail'),
                  icon: const Icon(Icons.info_outline, size: 16),
                  label: const Text('Detail', style: TextStyle(fontSize: 12)),
                ),
              ],
            ),
            if (machine.supportedWasteTypes != null &&
              machine.supportedWasteTypes!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              children: machine.supportedWasteTypes!
                  .map((wt) => Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: ReLoopColors.brand50,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          wt.name,
                          style: const TextStyle(
                            fontSize: 11,
                            color: ReLoopColors.brand700,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ))
                  .toList(),
            ),
          ],
        ],
      ),
    );
  }
}
