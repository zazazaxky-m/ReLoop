enum AppRole { user, pengepul, admin, superadmin }

AppRole parseRole(String value) => switch (value) {
  'PENGEPUL' => AppRole.pengepul,
  'ADMIN' => AppRole.admin,
  'SUPERADMIN' => AppRole.superadmin,
  _ => AppRole.user,
};

extension AppRoleX on AppRole {
  String get label => switch (this) {
    AppRole.user => 'Pengguna',
    AppRole.pengepul => 'Pengepul',
    AppRole.admin => 'Admin Organisasi',
    AppRole.superadmin => 'Superadmin',
  };
}

class AppUser {
  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.phone,
    this.organizationName,
  });

  final String id;
  final String name;
  final String email;
  final AppRole role;
  final String? phone;
  final String? organizationName;

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
    id: json['id']?.toString() ?? '',
    name: json['name']?.toString() ?? '',
    email: json['email']?.toString() ?? '',
    role: parseRole(json['role']?.toString() ?? 'USER'),
    phone: json['phone']?.toString(),
    organizationName: json['organizationName']?.toString(),
  );
}
