import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'superadmin_shell.dart';

class SuperadminRegionsScreen extends StatefulWidget {
  const SuperadminRegionsScreen({super.key});
  @override
  State<SuperadminRegionsScreen> createState() => _SuperadminRegionsScreenState();
}

class _SuperadminRegionsScreenState extends State<SuperadminRegionsScreen> {
  List<dynamic> _items = [];
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
      final res = await context.read<ApiClient>().get('/api/regions');
      setState(() {
        _items = (res.data as Map<String, dynamic>)['regions'] as List? ?? [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = ApiClient.getErrorMessage(e); _isLoading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SuperadminShell(title: 'Wilayah', child: RefreshIndicator(onRefresh: _load, child: _buildBody()));
  }

  Widget _buildBody() {
    if (_isLoading) return ListView(padding: const EdgeInsets.all(16), children: const [SkeletonListTile(), SizedBox(height: 8), SkeletonListTile()]);
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.cloud_off, size: 48, color: ReLoopColors.mutedSoft),
        const SizedBox(height: 12),
        Text(_error!, style: const TextStyle(color: ReLoopColors.muted)),
        TextButton(onPressed: _load, child: const Text('Coba Lagi')),
      ]));
    }
    if (_items.isEmpty) {
      return const Center(child: Text('Belum ada wilayah.', style: TextStyle(color: ReLoopColors.mutedSoft)));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: _items.map((r) => _buildCard(r)).toList(),
    );
  }

  Widget _buildCard(dynamic region) {
    final type = (region['type'] as String?) ?? 'REGION';
    final typeLabel = {'COUNTRY': 'Negara', 'PROVINCE': 'Provinsi', 'CITY': 'Kota', 'DISTRICT': 'Kecamatan'}[type] ?? type;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: ReLoopCard(
        child: Row(children: [
          Container(
            width: 40, height: 40,
            decoration: BoxDecoration(color: ReLoopColors.brand50, borderRadius: BorderRadius.circular(10)),
            child: const Icon(Icons.public, color: ReLoopColors.brand600, size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text((region['name'] as String?) ?? 'Wilayah', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
              Text(typeLabel, style: const TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
            ]),
          ),
        ]),
      ),
    );
  }
}
