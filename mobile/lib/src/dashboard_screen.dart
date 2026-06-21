import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'api_client.dart';
import 'models.dart';

final _rupiah = NumberFormat.currency(
  locale: 'id_ID',
  symbol: 'Rp',
  decimalDigits: 0,
);

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key, required this.api, required this.user});
  final ApiClient api;
  final AppUser user;

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final data = await widget.api.get('/api/mobile/overview');
      if (mounted) setState(() => _data = data);
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Dashboard gagal dimuat.');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_data == null && _error == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return _ErrorState(message: _error!, retry: _load);
    }
    final data = _data!;
    final metrics = _metrics(data);
    final lists = _lists(data);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            widget.user.role == AppRole.user
                ? 'Halo, ${widget.user.name.split(' ').first}!'
                : 'Dashboard ${widget.user.role.label}',
            style: Theme.of(
              context,
            ).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Text(
            widget.user.organizationName ??
                'Ringkasan aktivitas dan operasional ReLoop.',
            style: TextStyle(color: Colors.grey.shade700),
          ),
          const SizedBox(height: 20),
          LayoutBuilder(
            builder: (context, constraints) {
              final columns = constraints.maxWidth >= 1000
                  ? 4
                  : constraints.maxWidth >= 560
                  ? 3
                  : 2;
              return GridView.count(
                crossAxisCount: columns,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                childAspectRatio: constraints.maxWidth >= 560 ? 1.7 : 1.35,
                children: [
                  for (final metric in metrics) _MetricCard(metric: metric),
                ],
              );
            },
          ),
          const SizedBox(height: 22),
          for (final section in lists) ...[
            _DataSection(section: section),
            const SizedBox(height: 16),
          ],
        ],
      ),
    );
  }

  List<_Metric> _metrics(Map<String, dynamic> data) {
    switch (widget.user.role) {
      case AppRole.user:
        final balance = _map(data['balance']);
        return [
          _Metric(
            'Saldo tersedia',
            _rupiah.format(_num(balance['available'])),
            Icons.account_balance_wallet_outlined,
            Colors.green,
          ),
          _Metric(
            'Menunggu',
            _rupiah.format(_num(balance['pending'])),
            Icons.hourglass_top_outlined,
            Colors.amber,
          ),
          _Metric(
            'Total diperoleh',
            _rupiah.format(_num(balance['totalEarned'])),
            Icons.paid_outlined,
            Colors.orange,
          ),
          _Metric(
            'Campaign',
            _list(data['campaigns']).length.toString(),
            Icons.campaign_outlined,
            Colors.blue,
          ),
        ];
      case AppRole.pengepul:
        return [
          _Metric(
            'Tugas aktif',
            _list(data['tasks']).length.toString(),
            Icons.local_shipping_outlined,
            Colors.orange,
          ),
          _Metric(
            'Pickup tersedia',
            '${data['availableTasks'] ?? 0}',
            Icons.add_task_outlined,
            Colors.blue,
          ),
          _Metric(
            'Mesin penuh',
            _list(data['fullMachines']).length.toString(),
            Icons.recycling_outlined,
            Colors.red,
          ),
          _Metric(
            'Kemitraan',
            _list(data['partnerships']).length.toString(),
            Icons.handshake_outlined,
            Colors.teal,
          ),
        ];
      case AppRole.admin:
        final machines = _list(data['machines']);
        return [
          _Metric(
            'Mesin',
            machines.length.toString(),
            Icons.recycling_outlined,
            Colors.green,
          ),
          _Metric(
            'Mesin penuh',
            machines
                .where((e) => _map(e)['status'] == 'FULL')
                .length
                .toString(),
            Icons.warning_amber_outlined,
            Colors.orange,
          ),
          _Metric(
            'Campaign aktif',
            '${data['campaignCount'] ?? 0}',
            Icons.campaign_outlined,
            Colors.blue,
          ),
          _Metric(
            'Sesi selesai',
            '${data['depositCount'] ?? 0}',
            Icons.check_circle_outline,
            Colors.teal,
          ),
        ];
      case AppRole.superadmin:
        final security = _map(data['securitySummary']);
        return [
          _Metric(
            'Organisasi',
            '${data['organizationCount'] ?? 0}',
            Icons.business_outlined,
            Colors.green,
          ),
          _Metric(
            'Mesin',
            '${data['machineCount'] ?? 0}',
            Icons.recycling_outlined,
            Colors.teal,
          ),
          _Metric(
            'Pengguna',
            '${data['userCount'] ?? 0}',
            Icons.people_outline,
            Colors.blue,
          ),
          _Metric(
            'Reward tersedia',
            _rupiah.format(_num(data['rewardAvailable'])),
            Icons.account_balance_wallet_outlined,
            Colors.orange,
          ),
          _Metric(
            'Kemitraan pending',
            '${data['pendingPartners'] ?? 0}',
            Icons.handshake_outlined,
            Colors.amber,
          ),
          _Metric(
            'Pencairan pending',
            '${data['pendingRedemptions'] ?? 0}',
            Icons.payments_outlined,
            Colors.deepOrange,
          ),
          _Metric(
            'Alert 24 jam',
            '${security['alerts24h'] ?? 0}',
            Icons.security_outlined,
            Colors.red,
          ),
          _Metric(
            'Item diterima',
            '${data['depositCount'] ?? 0}',
            Icons.check_circle_outline,
            Colors.green,
          ),
        ];
    }
  }

  List<_Section> _lists(Map<String, dynamic> data) {
    switch (widget.user.role) {
      case AppRole.user:
        return [
          _Section('Sesi setor terakhir', _list(data['recentSessions'])),
          _Section('Program aktif', _list(data['campaigns'])),
          _Section('Riwayat reward', _list(data['recentLedger'])),
        ];
      case AppRole.pengepul:
        return [
          _Section('Tugas pickup', _list(data['tasks'])),
          _Section('Mesin penuh dari mitra', _list(data['fullMachines'])),
          _Section('Status kemitraan', _list(data['partnerships'])),
        ];
      case AppRole.admin:
        return [
          _Section('Status mesin', _list(data['machines'])),
          _Section('Pickup aktif', _list(data['pickups'])),
        ];
      case AppRole.superadmin:
        return [
          _Section(
            'Peringatan keamanan terbaru',
            _list(data['recentSecurityEvents']),
          ),
        ];
    }
  }
}

class _Metric {
  const _Metric(this.label, this.value, this.icon, this.color);
  final String label;
  final String value;
  final IconData icon;
  final Color color;
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.metric});
  final _Metric metric;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Icon(metric.icon, color: metric.color),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              metric.value,
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
            ),
          ),
          Text(metric.label, maxLines: 2, overflow: TextOverflow.ellipsis),
        ],
      ),
    ),
  );
}

class _Section {
  const _Section(this.title, this.items);
  final String title;
  final List<dynamic> items;
}

class _DataSection extends StatelessWidget {
  const _DataSection({required this.section});
  final _Section section;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            section.title,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          if (section.items.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Center(child: Text('Belum ada data.')),
            )
          else
            for (final item in section.items.take(8))
              _DashboardRow(data: _map(item)),
        ],
      ),
    ),
  );
}

class _DashboardRow extends StatelessWidget {
  const _DashboardRow({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final nested = [
      _map(data['machine'])['name'],
      _map(data['organization'])['name'],
      _map(data['campaign'])['name'],
    ].whereType<String>().where((e) => e.isNotEmpty).join(' • ');
    final title =
        data['name'] ??
        data['status'] ??
        data['entryType'] ??
        data['eventType'] ??
        nested;
    final subtitle = [
      if (nested.isNotEmpty && nested != title) nested,
      data['machineCode'],
      data['reason'],
      data['amount'] is num ? _rupiah.format(data['amount']) : null,
      data['startedAt'] ?? data['createdAt'] ?? data['occurredAt'],
    ].whereType<Object>().map((e) => e.toString()).join(' • ');

    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: const CircleAvatar(child: Icon(Icons.recycling_outlined)),
      title: Text(
        title?.toString().isNotEmpty == true ? title.toString() : 'ReLoop',
      ),
      subtitle: subtitle.isEmpty ? null : Text(subtitle, maxLines: 2),
      trailing: data['status'] == null
          ? null
          : _StatusChip(data['status'].toString()),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip(this.status);
  final String status;

  @override
  Widget build(BuildContext context) => Chip(
    label: Text(status.replaceAll('_', ' ')),
    visualDensity: VisualDensity.compact,
  );
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_outlined, size: 52),
          const SizedBox(height: 12),
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: retry,
            icon: const Icon(Icons.refresh),
            label: const Text('Coba lagi'),
          ),
        ],
      ),
    ),
  );
}

Map<String, dynamic> _map(dynamic value) =>
    value is Map<String, dynamic> ? value : <String, dynamic>{};
List<dynamic> _list(dynamic value) => value is List ? value : const [];
num _num(dynamic value) => value is num ? value : 0;
