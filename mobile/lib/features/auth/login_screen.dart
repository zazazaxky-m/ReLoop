import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/auth_provider.dart';
import '../../services/biometric_service.dart';
import '../../shared/widgets/reloop_button.dart';
import '../../shared/widgets/reloop_logo.dart';
import '../../theme/colors.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _obscurePassword = true;
  bool _biometricAvailable = false;
  bool _biometricEnabled = false;
  String? _biometricType;

  @override
  void initState() {
    super.initState();
    _checkBiometric();
  }

  Future<void> _checkBiometric() async {
    final bio = BiometricService();
    final available = await bio.isBiometricAvailable;
    final enabled = await bio.isEnabled;
    if (mounted) {
      setState(() {
        _biometricAvailable = available;
        _biometricEnabled = enabled;
      });
    }
    if (available) {
      final typeName = await bio.getBiometricTypeName();
      if (mounted) {
        setState(() => _biometricType = typeName);
      }
      if (enabled) {
        _attemptBiometricLogin();
      }
    }
  }

  Future<void> _attemptBiometricLogin() async {
    final bio = BiometricService();
    final authenticated = await bio.authenticate(
      reason: 'Gunakan $_biometricType untuk login ke ReLoop',
    );
    if (!authenticated || !mounted) return;

    final creds = await bio.getCredentials();
    if (creds == null || !mounted) return;

    _emailCtrl.text = creds.email;
    _passwordCtrl.text = creds.password;
    await _login();
  }

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;

    final auth = context.read<AuthProvider>();
    final success = await auth.login(
      _emailCtrl.text.trim(),
      _passwordCtrl.text,
    );

    if (success && mounted) {
      final bio = BiometricService();
      if (await bio.isEnabled) {
        await bio.saveCredentials(
          _emailCtrl.text.trim(),
          _passwordCtrl.text,
        );
      }
      context.go(auth.dashboardRoute);
    }
  }

  Widget _buildLabel(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: RichText(
        text: TextSpan(
          text: text,
          style: const TextStyle(
            color: Color(0xFF0F3D21), // emerald-950
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
          children: const [
            TextSpan(
              text: ' *',
              style: TextStyle(color: ReLoopColors.danger),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();

    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF7),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const ReLoopLogo(height: 36),
              const SizedBox(height: 32),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: const Color(0x0D064E3B)),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x1A064E3B),
                      blurRadius: 70,
                      offset: Offset(0, 24),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'SELAMAT DATANG KEMBALI',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.6,
                        color: ReLoopColors.brand600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Masuk ke ReLoop',
                      style: TextStyle(
                        fontSize: 26,
                        fontWeight: FontWeight.w900,
                        color: Color(0xFF0F3D21),
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Lanjutkan aksi baikmu dari sini.',
                      style: TextStyle(
                        color: Color(0x8C0F3D21),
                        fontSize: 14,
                        height: 1.5,
                      ),
                    ),
                    const SizedBox(height: 28),
                    Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _buildLabel('Email'),
                          TextFormField(
                            controller: _emailCtrl,
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            style: const TextStyle(fontSize: 15),
                            decoration: InputDecoration(
                              hintText: 'nama@email.com',
                              hintStyle: const TextStyle(
                                color: ReLoopColors.mutedSoft,
                                fontSize: 15,
                              ),
                              fillColor: const Color(0xFFFBFDFB),
                              filled: true,
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 14,
                              ),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: Color(0x1A0F3D21)),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: Color(0x1A0F3D21)),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: Color(0x330F3D21)),
                              ),
                            ),
                            validator: (v) {
                              if (v == null || v.trim().isEmpty) {
                                return 'Email wajib diisi';
                              }
                              final emailRegex =
                                  RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$');
                              if (!emailRegex.hasMatch(v.trim())) {
                                return 'Format email tidak valid';
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 16),
                          _buildLabel('Password'),
                          TextFormField(
                            controller: _passwordCtrl,
                            obscureText: _obscurePassword,
                            textInputAction: TextInputAction.done,
                            onFieldSubmitted: (_) => _login(),
                            style: const TextStyle(fontSize: 15),
                            decoration: InputDecoration(
                              hintText: '••••••••',
                              hintStyle: const TextStyle(
                                color: ReLoopColors.mutedSoft,
                                fontSize: 15,
                                letterSpacing: 2.0,
                              ),
                              fillColor: const Color(0xFFFBFDFB),
                              filled: true,
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 14,
                              ),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: Color(0x1A0F3D21)),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: Color(0x1A0F3D21)),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(
                                    color: Color(0x330F3D21)),
                              ),
                              suffixIcon: IconButton(
                                icon: Icon(
                                  _obscurePassword
                                      ? Icons.visibility_off_outlined
                                      : Icons.visibility_outlined,
                                  size: 20,
                                  color: ReLoopColors.mutedSoft,
                                ),
                                onPressed: () {
                                  setState(() {
                                    _obscurePassword = !_obscurePassword;
                                  });
                                },
                              ),
                            ),
                            validator: (v) {
                              if (v == null || v.isEmpty) {
                                return 'Password wajib diisi';
                              }
                              if (v.length < 6) {
                                return 'Password minimal 6 karakter';
                              }
                              return null;
                            },
                          ),
                        ],
                      ),
                    ),
                    if (auth.error != null) ...[
                      const SizedBox(height: 16),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF2F2),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: const Color(0xFFFECACA)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.error_outline,
                                size: 16, color: ReLoopColors.danger),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                auth.error!,
                                style: const TextStyle(
                                  color: ReLoopColors.danger,
                                  fontSize: 13,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      child: ReLoopButton(
                        label: 'Masuk',
                        onPressed: auth.isLoading ? null : _login,
                        isLoading: auth.isLoading,
                        size: ReLoopButtonSize.lg,
                      ),
                    ),
                    if (_biometricAvailable && _biometricEnabled) ...[
                      const SizedBox(height: 16),
                      const Center(
                        child: Text(
                          'atau',
                          style: TextStyle(
                              color: ReLoopColors.mutedSoft, fontSize: 13),
                        ),
                      ),
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: _attemptBiometricLogin,
                          icon: Icon(
                            _biometricType == 'Face ID'
                                ? Icons.face
                                : Icons.fingerprint,
                            color: ReLoopColors.brand600,
                          ),
                          label: Text(
                            'Login dengan $_biometricType',
                            style: const TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: 14,
                            ),
                          ),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: ReLoopColors.brand600,
                            side: const BorderSide(
                                color: ReLoopColors.brand200),
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: 24),
                    Align(
                      alignment: Alignment.center,
                      child: GestureDetector(
                        onTap: () => context.push('/register'),
                        child: const Text.rich(
                          TextSpan(
                            text: 'Belum punya akun? ',
                            style: TextStyle(
                              color: ReLoopColors.mutedSoft,
                              fontSize: 14,
                            ),
                            children: [
                              TextSpan(
                                text: 'Daftar',
                                style: TextStyle(
                                  color: ReLoopColors.brand600,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              Align(
                alignment: Alignment.center,
                child: GestureDetector(
                  onTap: () {
                    context.go('/onboarding');
                  },
                  child: const Text(
                    '← Kembali ke pengenalan',
                    style: TextStyle(
                      color: Color(0x730F3D21), // emerald-950/45
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

