import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'superadmin_shell.dart';

class SuperadminRedemptionsScreen extends StatefulWidget {
  const SuperadminRedemptionsScreen({super.key});
  @override
  State<SuperadminRedemptionsScreen> createState() => _SuperadminRedemptionsScreenState();
}

class _SuperadminRedemptionsScreenState extends State<SuperadminRedemptionsScreen> {
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
      final res = await context.read<ApiClient>().get('/api/redemptions?queue=1');
      setState(() {
        _items = (res.data as Map<String, dynamic>)['redemptions'] as List? ?? [];
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = ApiClient.getErrorMessage(e); _isLoading = false; });
    }
  }

  Future<void> _approve(String id) async {
    try {
      await context.read<ApiClient>().patch('/api/redemptions/$id', data: {'action': 'APPROVE'});
      if (!mounted) return;
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ApiClient.getErrorMessage(e)), backgroundColor: ReLoopColors.danger));
      }
    }
  }

  Future<void> _reject(String id) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final ctrl = TextEditingController();
        return AlertDialog(
          title: const Text('Tolak Redemption'),
          content: TextField(controller: ctrl, decoration: const InputDecoration(hintText: 'Alasan penolakan'), maxLines: 3),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
            ElevatedButton(onPressed: () => Navigator.pop(ctx, ctrl.text), child: const Text('Tolak')),
          ],
        );
      },
    );
    if (reason == null) return;
    if (!mounted) return;
    try {
      await context.read<ApiClient>().patch('/api/redemptions/$id', data: {'action': 'REJECT', 'note': reason});
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ApiClient.getErrorMessage(e)), backgroundColor: ReLoopColors.danger));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SuperadminShell(title: 'Antrian Redemption', child: RefreshIndicator(onRefresh: _load, child: _buildBody()));
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
      return const Center(child: Text('Tidak ada antrian redemption.', style: TextStyle(color: ReLoopColors.mutedSoft)));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: _items.map((r) => _buildCard(r)).toList(),
    );
  }

  Widget _buildCard(dynamic redemption) {
    final status = (redemption['status'] as String?) ?? 'PENDING';
    final amount = (redemption['amount'] as num?)?.toDouble() ?? 0;
    final user = redemption['user'] as Map<String, dynamic>?;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: ReLoopCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Text('Rp ${amount.toStringAsFixed(0)}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: ReLoopColors.brand700)),
                const SizedBox(width: 8),
                StatusBadge(statusKey: status),
              ]),
              if (user != null) ...[
                const SizedBox(height: 4),
                Text('${user['name'] ?? '-'} · ${user['email'] ?? ''}', style: const TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
              ],
            ])),
          ]),
          if (redemption['note'] != null) ...[
            const SizedBox(height: 6),
            Text(redemption['note'] as String, style: const TextStyle(fontSize: 12, color: ReLoopColors.mutedSoft)),
          ],
          if (status == 'PENDING') ...[
            const SizedBox(height: 10),
            Row(children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => _reject(redemption['id'] as String),
                  style: OutlinedButton.styleFrom(foregroundColor: ReLoopColors.danger),
                  child: const Text('Tolak'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: ElevatedButton(
                  onPressed: () => _approve(redemption['id'] as String),
                  style: ElevatedButton.styleFrom(backgroundColor: ReLoopColors.success),
                  child: const Text('Setujui'),
                ),
              ),
            ]),
          ],
        ]),
      ),
    );
  }
}
