import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'superadmin_shell.dart';

class SuperadminOrganizationsScreen extends StatefulWidget {
  const SuperadminOrganizationsScreen({super.key});
  @override
  State<SuperadminOrganizationsScreen> createState() => _SuperadminOrganizationsScreenState();
}

class _SuperadminOrganizationsScreenState extends State<SuperadminOrganizationsScreen> {
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
      final res = await context.read<ApiClient>().get('/api/organizations');
      setState(() {
        _items = (res.data as Map<String, dynamic>)['organizations'] as List? ?? [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = ApiClient.getErrorMessage(e); _isLoading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SuperadminShell(title: 'Organisasi', child: RefreshIndicator(onRefresh: _load, child: _buildBody()));
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
      return const Center(child: Text('Belum ada organisasi.', style: TextStyle(color: ReLoopColors.mutedSoft)));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: _items.map((o) => _buildCard(o)).toList(),
    );
  }

  Widget _buildCard(dynamic org) {
    final status = (org['status'] as String?) ?? 'ACTIVE';
    final type = (org['type'] as String?) ?? '-';
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: ReLoopCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text((org['name'] as String?) ?? 'Organisasi', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
              if (org['contactName'] != null) ...[
                const SizedBox(height: 2),
                Text('PIC: ${org['contactName']}', style: const TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
              ],
            ])),
            StatusBadge(statusKey: status),
          ]),
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            _chip(Icons.business_outlined, type),
            if (org['address'] != null) _chip(Icons.location_on_outlined, org['address'] as String),
          ]),
        ]),
      ),
    );
  }

  Widget _chip(IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(color: ReLoopColors.brand50, borderRadius: BorderRadius.circular(6)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 12, color: ReLoopColors.brand600),
        const SizedBox(width: 4),
        Text(label, style: const TextStyle(fontSize: 11, color: ReLoopColors.brand700)),
      ]),
    );
  }
}
