import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'superadmin_shell.dart';

class SuperadminUsersScreen extends StatefulWidget {
  const SuperadminUsersScreen({super.key});
  @override
  State<SuperadminUsersScreen> createState() => _SuperadminUsersScreenState();
}

class _SuperadminUsersScreenState extends State<SuperadminUsersScreen> {
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
      final res = await context.read<ApiClient>().get('/api/users');
      setState(() {
        _items = (res.data as Map<String, dynamic>)['users'] as List? ?? [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = ApiClient.getErrorMessage(e); _isLoading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SuperadminShell(title: 'Pengguna', child: RefreshIndicator(onRefresh: _load, child: _buildBody()));
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
      return const Center(child: Text('Belum ada pengguna.', style: TextStyle(color: ReLoopColors.mutedSoft)));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: _items.map((u) => _buildCard(u)).toList(),
    );
  }

  Widget _buildCard(dynamic user) {
    final roleStr = (user['role'] as String?) ?? 'USER';
    final roleLabel = AppRole.values
        .firstWhere((r) => r.apiValue == roleStr, orElse: () => AppRole.USER)
        .label;
    final status = (user['status'] as String?) ?? 'ACTIVE';
    final isActive = status == 'ACTIVE';

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: ReLoopCard(
        child: Row(children: [
          CircleAvatar(
            radius: 20,
            backgroundColor: isActive ? ReLoopColors.brand50 : ReLoopColors.mutedSoft.withValues(alpha: 0.2),
            child: Text(
              ((user['name'] as String?) ?? '?')[0].toUpperCase(),
              style: TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 16,
                color: isActive ? ReLoopColors.brand600 : ReLoopColors.mutedSoft,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text((user['name'] as String?) ?? 'Tanpa Nama', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
              if (user['email'] != null) ...[
                const SizedBox(height: 2),
                Text(user['email'] as String, style: const TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
              ],
            ]),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: ReLoopColors.brand50,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(roleLabel, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: ReLoopColors.brand600)),
              ),
              const SizedBox(height: 4),
              Container(
                width: 8, height: 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isActive ? ReLoopColors.success : ReLoopColors.mutedSoft,
                ),
              ),
            ],
          ),
        ]),
      ),
    );
  }
}
