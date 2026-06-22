import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api_client.dart';

class MapScreen extends StatefulWidget {
  const MapScreen({super.key, required this.api});
  final ApiClient api;

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> {
  List<dynamic>? machines;
  List<dynamic> campaigns = [];
  String? error;

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final data = await widget.api.get('/api/mobile/map');
      if (mounted) {
        setState(() {
          machines = data['machines'] as List;
          campaigns = data['campaigns'] as List;
          error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (machines == null) {
      return error == null
          ? const Center(child: CircularProgressIndicator())
          : Center(child: Text(error!));
    }
    return RefreshIndicator(
      onRefresh: load,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Row(
                children: [
                  const Icon(Icons.map_outlined, size: 38),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      '${machines!.length} mesin • ${campaigns.length} program publik',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          for (final raw in machines!)
            _MachineLocation(machine: raw as Map<String, dynamic>),
          if (campaigns.isNotEmpty) ...[
            const SizedBox(height: 18),
            const Text(
              'Program di sekitar mesin',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 8),
            for (final raw in campaigns)
              ListTile(
                leading: const CircleAvatar(
                  child: Icon(Icons.campaign_outlined),
                ),
                title: Text((raw as Map)['name'].toString()),
                subtitle: Text(
                  ((raw['organization'] as Map?)?['name'] ?? '').toString(),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _MachineLocation extends StatelessWidget {
  const _MachineLocation({required this.machine});
  final Map<String, dynamic> machine;

  @override
  Widget build(BuildContext context) {
    final organization = machine['organization'] as Map<String, dynamic>? ?? {};
    final waste = machine['supportedWasteTypes'] as List? ?? [];
    final lat = machine['latitude'];
    final lng = machine['longitude'];
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const CircleAvatar(child: Icon(Icons.recycling_outlined)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          machine['name'].toString(),
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                        Text(
                          '${organization['name'] ?? ''} • ${machine['machineCode']}',
                        ),
                      ],
                    ),
                  ),
                  Chip(label: Text(machine['status'].toString())),
                ],
              ),
              const SizedBox(height: 12),
              LinearProgressIndicator(
                value: ((machine['fillLevelPercent'] as num?) ?? 0) / 100,
                minHeight: 8,
                borderRadius: BorderRadius.circular(8),
              ),
              const SizedBox(height: 6),
              Text('Terisi ${machine['fillLevelPercent']}%'),
              if (waste.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  'Menerima: ${waste.map((e) => (e as Map)['name']).join(', ')}',
                  style: TextStyle(color: Colors.grey.shade700),
                ),
              ],
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton.tonalIcon(
                  onPressed: lat == null || lng == null
                      ? null
                      : () => launchUrl(
                          Uri.parse(
                            'https://www.google.com/maps/search/?api=1&query=$lat,$lng',
                          ),
                          mode: LaunchMode.externalApplication,
                        ),
                  icon: const Icon(Icons.directions_outlined),
                  label: const Text('Petunjuk arah'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
