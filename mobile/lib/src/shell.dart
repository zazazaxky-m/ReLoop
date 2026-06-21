import 'package:flutter/material.dart';

import 'api_client.dart';
import 'dashboard_screen.dart';
import 'map_screen.dart';
import 'models.dart';
import 'resource_screen.dart';
import 'scan_screen.dart';
import 'wallet_screen.dart';

class AppModule {
  const AppModule(this.title, this.icon, this.builder);
  final String title;
  final IconData icon;
  final Widget Function() builder;
}

class AppShell extends StatefulWidget {
  const AppShell({
    super.key,
    required this.api,
    required this.user,
    required this.onSignOut,
  });

  final ApiClient api;
  final AppUser user;
  final Future<void> Function() onSignOut;

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _selected = 0;

  List<AppModule> get _modules {
    final api = widget.api;
    final role = widget.user.role;
    final modules = <AppModule>[
      AppModule(
        'Dashboard',
        Icons.dashboard_outlined,
        () => DashboardScreen(api: api, user: widget.user),
      ),
    ];

    if (role == AppRole.user) {
      modules.addAll([
        AppModule(
          'Scan Mesin',
          Icons.qr_code_scanner,
          () => ScanScreen(api: api),
        ),
        AppModule('Peta Mesin', Icons.map_outlined, () => MapScreen(api: api)),
        AppModule(
          'Dompet',
          Icons.account_balance_wallet_outlined,
          () => WalletScreen(api: api),
        ),
        AppModule(
          'Campaign',
          Icons.campaign_outlined,
          () => ResourceScreen(
            api: api,
            title: 'Campaign',
            endpoint: '/api/mobile/overview',
            rootKey: 'campaigns',
            primaryFields: const ['name', 'status'],
            secondaryFields: const ['description', 'startAt', 'endAt'],
          ),
        ),
        AppModule(
          'Trip / Trash Bag',
          Icons.delete_outline,
          () => ResourceScreen(
            api: api,
            title: 'Trip / Trash Bag',
            endpoint: '/api/trips',
            rootKey: 'trips',
            primaryFields: const ['groupName', 'status'],
            secondaryFields: const ['participantCount', 'createdAt'],
          ),
        ),
        AppModule(
          'Profil',
          Icons.person_outline,
          () => ProfileScreen(user: widget.user),
        ),
      ]);
    } else if (role == AppRole.pengepul) {
      modules.addAll([
        AppModule(
          'Tugas Pickup',
          Icons.local_shipping_outlined,
          () => ResourceScreen(
            api: api,
            title: 'Tugas Pickup',
            endpoint: '/api/pickups',
            rootKey: 'pickups',
            primaryFields: const ['status', 'reason'],
            secondaryFields: const ['priority', 'notes', 'createdAt'],
            actionType: ResourceActionType.pickup,
          ),
        ),
        AppModule(
          'Pickup Tersedia',
          Icons.add_task_outlined,
          () => ResourceScreen(
            api: api,
            title: 'Pickup Tersedia',
            endpoint: '/api/pickups?scope=available',
            rootKey: 'pickups',
            primaryFields: const ['status', 'reason'],
            secondaryFields: const ['priority', 'notes', 'createdAt'],
          ),
        ),
        AppModule('Peta Mesin', Icons.map_outlined, () => MapScreen(api: api)),
        AppModule(
          'Area & Kemitraan',
          Icons.handshake_outlined,
          () => ResourceScreen(
            api: api,
            title: 'Area & Kemitraan',
            endpoint: '/api/partnerships',
            rootKey: 'partnerships',
            primaryFields: const ['status', 'contactName'],
            secondaryFields: const ['contactPhone', 'notes', 'updatedAt'],
            actionType: ResourceActionType.partnership,
          ),
        ),
        AppModule(
          'Profil',
          Icons.person_outline,
          () => ProfileScreen(user: widget.user),
        ),
      ]);
    } else if (role == AppRole.admin) {
      modules.addAll([
        _resource(
          'Mesin',
          Icons.recycling_outlined,
          '/api/machines',
          'machines',
          ['name', 'status'],
          ['machineCode', 'fillLevelPercent', 'capacityKg'],
        ),
        _resource(
          'Pickup',
          Icons.local_shipping_outlined,
          '/api/pickups',
          'pickups',
          ['status', 'reason'],
          ['priority', 'notes', 'createdAt'],
          action: ResourceActionType.pickup,
        ),
        _resource(
          'Campaign',
          Icons.campaign_outlined,
          '/api/campaigns',
          'campaigns',
          ['name', 'status'],
          ['visibility', 'campaignType', 'startAt'],
        ),
        _resource(
          'Jenis Sampah',
          Icons.delete_outline,
          '/api/waste-types',
          'wasteTypes',
          ['name', 'active'],
          ['unit', 'minWeightGrams', 'maxWeightGrams'],
        ),
        _resource(
          'Tarif Reward',
          Icons.paid_outlined,
          '/api/reward-rates',
          'rates',
          ['pointsPerItem', 'active'],
          ['unit', 'effectiveFrom', 'effectiveTo'],
        ),
        _resource(
          'Mitra Pengepul',
          Icons.handshake_outlined,
          '/api/partnerships',
          'partnerships',
          ['status', 'contactName'],
          ['contactPhone', 'notes'],
          action: ResourceActionType.partnership,
        ),
        _resource(
          'Trip / Trash Bag',
          Icons.luggage_outlined,
          '/api/trips',
          'trips',
          ['groupName', 'status'],
          ['participantCount', 'createdAt'],
        ),
        AppModule('Peta', Icons.map_outlined, () => MapScreen(api: api)),
        AppModule(
          'Laporan',
          Icons.description_outlined,
          () => ReportsScreen(api: api),
        ),
        AppModule(
          'Profil',
          Icons.person_outline,
          () => ProfileScreen(user: widget.user),
        ),
      ]);
    } else {
      modules.addAll([
        _resource(
          'Organisasi',
          Icons.business_outlined,
          '/api/organizations',
          'organizations',
          ['name', 'status'],
          ['type', 'address', 'contactName'],
        ),
        _resource(
          'Mesin',
          Icons.recycling_outlined,
          '/api/machines',
          'machines',
          ['name', 'status'],
          ['machineCode', 'fillLevelPercent', 'capacityKg'],
        ),
        _resource(
          'Pengguna',
          Icons.people_outline,
          '/api/users',
          'users',
          ['name', 'role'],
          ['email', 'status', 'phone'],
        ),
        _resource(
          'Kemitraan',
          Icons.handshake_outlined,
          '/api/partnerships',
          'partnerships',
          ['status', 'contactName'],
          ['contactPhone', 'notes'],
          action: ResourceActionType.partnership,
        ),
        _resource(
          'Redemption',
          Icons.account_balance_wallet_outlined,
          '/api/redemptions?queue=1',
          'redemptions',
          ['amount', 'status'],
          ['provider', 'createdAt', 'note'],
          action: ResourceActionType.redemption,
        ),
        _resource(
          'Wilayah',
          Icons.public_outlined,
          '/api/regions',
          'regions',
          ['name', 'type'],
          ['parentId', 'createdAt'],
        ),
        _resource(
          'Jenis Sampah',
          Icons.delete_outline,
          '/api/waste-types',
          'wasteTypes',
          ['name', 'active'],
          ['unit', 'defaultRewardPerItem'],
        ),
        _resource(
          'Tarif Reward',
          Icons.paid_outlined,
          '/api/reward-rates',
          'rates',
          ['pointsPerItem', 'active'],
          ['unit', 'effectiveFrom'],
        ),
        AppModule('Peta', Icons.map_outlined, () => MapScreen(api: api)),
        AppModule(
          'Keamanan & Audit',
          Icons.security_outlined,
          () => AuditSecurityScreen(api: api),
        ),
        AppModule(
          'Konfigurasi',
          Icons.settings_outlined,
          () => ConfigScreen(api: api),
        ),
        AppModule(
          'Laporan',
          Icons.description_outlined,
          () => ReportsScreen(api: api),
        ),
        AppModule(
          'Profil',
          Icons.person_outline,
          () => ProfileScreen(user: widget.user),
        ),
      ]);
    }
    return modules;
  }

  AppModule _resource(
    String title,
    IconData icon,
    String endpoint,
    String key,
    List<String> primary,
    List<String> secondary, {
    ResourceActionType action = ResourceActionType.none,
  }) => AppModule(
    title,
    icon,
    () => ResourceScreen(
      api: widget.api,
      title: title,
      endpoint: endpoint,
      rootKey: key,
      primaryFields: primary,
      secondaryFields: secondary,
      actionType: action,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final modules = _modules;
    if (_selected >= modules.length) _selected = 0;
    return LayoutBuilder(
      builder: (context, constraints) {
        final tablet = constraints.maxWidth >= 760;
        final body = KeyedSubtree(
          key: ValueKey('${widget.user.role.name}-$_selected'),
          child: modules[_selected].builder(),
        );

        if (tablet) {
          return Scaffold(
            body: Row(
              children: [
                NavigationRail(
                  extended: constraints.maxWidth >= 1100,
                  selectedIndex: _selected,
                  onDestinationSelected: (value) =>
                      setState(() => _selected = value),
                  leading: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16),
                    child: Icon(Icons.recycling_rounded, size: 42),
                  ),
                  trailing: Expanded(
                    child: Align(
                      alignment: Alignment.bottomCenter,
                      child: Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: IconButton(
                          tooltip: 'Keluar',
                          onPressed: widget.onSignOut,
                          icon: const Icon(Icons.logout),
                        ),
                      ),
                    ),
                  ),
                  destinations: [
                    for (final module in modules)
                      NavigationRailDestination(
                        icon: Icon(module.icon),
                        label: Text(module.title),
                      ),
                  ],
                ),
                const VerticalDivider(width: 1),
                Expanded(child: body),
              ],
            ),
          );
        }

        final primaryCount = modules.length < 4 ? modules.length : 4;
        return Scaffold(
          appBar: AppBar(
            title: Text(modules[_selected].title),
            actions: [
              PopupMenuButton<int>(
                tooltip: 'Menu lainnya',
                onSelected: (value) => setState(() => _selected = value),
                itemBuilder: (context) => [
                  for (var i = primaryCount; i < modules.length; i++)
                    PopupMenuItem(
                      value: i,
                      child: ListTile(
                        leading: Icon(modules[i].icon),
                        title: Text(modules[i].title),
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                  PopupMenuItem(
                    value: -1,
                    onTap: widget.onSignOut,
                    child: const ListTile(
                      leading: Icon(Icons.logout),
                      title: Text('Keluar'),
                      contentPadding: EdgeInsets.zero,
                    ),
                  ),
                ],
              ),
            ],
          ),
          body: body,
          bottomNavigationBar: NavigationBar(
            selectedIndex: _selected < primaryCount ? _selected : primaryCount,
            onDestinationSelected: (value) {
              if (value < primaryCount) {
                setState(() => _selected = value);
              } else {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Pilih menu lainnya dari kanan atas.'),
                  ),
                );
              }
            },
            destinations: [
              for (var i = 0; i < primaryCount; i++)
                NavigationDestination(
                  icon: Icon(modules[i].icon),
                  label: modules[i].title,
                ),
              const NavigationDestination(
                icon: Icon(Icons.more_horiz),
                label: 'Lainnya',
              ),
            ],
          ),
        );
      },
    );
  }
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key, required this.user});
  final AppUser user;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      Card(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              CircleAvatar(
                radius: 38,
                child: Text(
                  user.name.isEmpty ? '?' : user.name[0].toUpperCase(),
                  style: const TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(user.name, style: Theme.of(context).textTheme.headlineSmall),
              Text(user.role.label),
              const Divider(height: 32),
              ListTile(
                leading: const Icon(Icons.email_outlined),
                title: Text(user.email),
              ),
              if (user.phone != null)
                ListTile(
                  leading: const Icon(Icons.phone_outlined),
                  title: Text(user.phone!),
                ),
              if (user.organizationName != null)
                ListTile(
                  leading: const Icon(Icons.business_outlined),
                  title: Text(user.organizationName!),
                ),
            ],
          ),
        ),
      ),
    ],
  );
}
