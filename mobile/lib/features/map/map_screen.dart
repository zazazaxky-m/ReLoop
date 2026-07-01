import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' show LatLng;
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/auth_provider.dart';
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
  List<CampaignInfo> _campaigns = [];
  bool _isLoading = true;
  String? _error;
  MachineInfo? _selectedMachine;
  CampaignInfo? _selectedCampaign;

  @override
  void initState() {
    super.initState();
    _loadAll();
  }

  Future<void> _loadAll() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final api = context.read<ApiClient>();
      final auth = context.read<AuthProvider>();
      final isPengepul = auth.user?.role == AppRole.PENGEPUL;

      final machinesQuery = isPengepul
          ? <String, String>{'scope': 'partners'}
          : <String, String>{};

      final results = await Future.wait([
        api.get('/api/public/machines', queryParameters: machinesQuery),
        api.get('/api/public/campaigns'),
      ]);

      final machinesData = results[0].data as Map<String, dynamic>;
      final campaignsData = results[1].data as Map<String, dynamic>;

      setState(() {
        _machines = (machinesData['machines'] as List? ?? [])
            .map((e) => MachineInfo.fromJson(e as Map<String, dynamic>))
            .where((m) => m.latitude != null && m.longitude != null)
            .toList();
        _campaigns = (campaignsData['campaigns'] as List? ?? [])
            .map((e) => CampaignInfo.fromJson(e as Map<String, dynamic>))
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
    if (_isLoading) {
      return const Scaffold(body: SkeletonDashboard());
    }

    if (_error != null) {
      return Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.cloud_off, size: 48, color: context.reloopMutedSoft),
              const SizedBox(height: 12),
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: TextStyle(color: context.reloopMuted),
              ),
              const SizedBox(height: 12),
              TextButton(onPressed: _loadAll, child: Text('Coba Lagi')),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      body: Stack(
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
              onTap: (_, _) {
                setState(() {
                  _selectedMachine = null;
                  _selectedCampaign = null;
                });
              },
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'id.reloop.mobile',
              ),
              MarkerLayer(
                markers: [
                  ..._machines.map((m) {
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
                          setState(() {
                            _selectedMachine = m;
                            _selectedCampaign = null;
                          });
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
                  }),
                  ..._campaigns.map((c) {
                    final isSelected = _selectedCampaign?.id == c.id;
                    return Marker(
                      point: const LatLng(-6.2088, 106.8456),
                      width: isSelected ? 44 : 36,
                      height: isSelected ? 44 : 36,
                      child: GestureDetector(
                        onTap: () {
                          setState(() {
                            _selectedCampaign = c;
                            _selectedMachine = null;
                          });
                        },
                        child: Container(
                          decoration: BoxDecoration(
                            color: ReLoopColors.brand600,
                            shape: BoxShape.rectangle,
                            borderRadius: BorderRadius.circular(8),
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
                            Icons.campaign,
                            color: Colors.white,
                            size: 18,
                          ),
                        ),
                      ),
                    );
                  }),
                ],
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
                onClose: () => setState(() => _selectedMachine = null),
              ),
            ),
          if (_selectedCampaign != null)
            Positioned(
              bottom: 16,
              left: 16,
              right: 16,
              child: _CampaignInfoCard(
                campaign: _selectedCampaign!,
                onClose: () => setState(() => _selectedCampaign = null),
              ),
            ),
          Positioned(
            top: 12,
            left: 12,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: context.reloopSurfaceRaised,
                borderRadius: BorderRadius.circular(8),
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
              child: Text(
                '${_machines.length} mesin · ${_campaigns.length} program',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: context.reloopMuted,
                ),
              ),
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

  const _MachineInfoCard({required this.machine, required this.onClose});

  @override
  Widget build(BuildContext context) {
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
                  machine.name,
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: context.reloopForeground,
                    fontSize: 15,
                  ),
                ),
              ),
              GestureDetector(
                onTap: onClose,
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
            machine.machineCode,
            style: TextStyle(color: context.reloopMutedSoft, fontSize: 12),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              StatusBadge(statusKey: machine.status),
              const SizedBox(width: 8),
              if (machine.fillLevelPercent > 0)
                Text(
                  'Isi: ${machine.fillLevelPercent}%',
                  style: TextStyle(
                    color: context.reloopMuted,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              const Spacer(),
              TextButton.icon(
                onPressed: () =>
                    context.push('/machine/${machine.machineCode}/detail'),
                icon: const Icon(Icons.info_outline, size: 16),
                label: Text('Detail', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
          if (machine.supportedWasteTypes != null &&
              machine.supportedWasteTypes!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              children: machine.supportedWasteTypes!
                  .map(
                    (wt) => Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: context.reloopBrandSoft,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        wt.name,
                        style: TextStyle(
                          fontSize: 11,
                          color: context.reloopBrandText,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  )
                  .toList(),
            ),
          ],
        ],
      ),
    );
  }
}

class _CampaignInfoCard extends StatelessWidget {
  final CampaignInfo campaign;
  final VoidCallback onClose;

  const _CampaignInfoCard({required this.campaign, required this.onClose});

  @override
  Widget build(BuildContext context) {
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
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: context.reloopBrandSoft,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  Icons.campaign,
                  color: context.isDarkMode
                      ? ReLoopColors.brand400
                      : ReLoopColors.brand600,
                  size: 16,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      campaign.name,
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: context.reloopForeground,
                        fontSize: 14,
                      ),
                    ),
                    if (campaign.organizationName != null)
                      Text(
                        campaign.organizationName!,
                        style: TextStyle(
                          color: context.reloopMutedSoft,
                          fontSize: 11,
                        ),
                      ),
                  ],
                ),
              ),
              GestureDetector(
                onTap: onClose,
                child: Icon(
                  Icons.close,
                  size: 20,
                  color: context.reloopMutedSoft,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              StatusBadge(statusKey: campaign.status),
              if (campaign.rewardMultiplier != null) ...[
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: context.reloopBrandSoft,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    '${campaign.rewardMultiplier!.toStringAsFixed(1)}x reward',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: context.reloopBrandText,
                    ),
                  ),
                ),
              ],
            ],
          ),
          if (campaign.description != null) ...[
            const SizedBox(height: 8),
            Text(
              campaign.description!,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12, color: context.reloopMuted),
            ),
          ],
        ],
      ),
    );
  }
}
