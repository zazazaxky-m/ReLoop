import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:smooth_page_indicator/smooth_page_indicator.dart';
import 'package:go_router/go_router.dart';
import '../../theme/colors.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _controller = PageController();
  final _storage = const FlutterSecureStorage();
  bool _isLastPage = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _complete() async {
    await _storage.write(key: 'onboarding_completed', value: 'true');
    if (mounted) context.go('/login');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: PageView(
                controller: _controller,
                onPageChanged: (index) {
                  setState(() => _isLastPage = index == 2);
                },
                children: const [
                  _OnboardingPage(
                    icon: Icons.recycling,
                    title: 'Selamat Datang di ReLoop',
                    description: 'Aplikasi pengelolaan sampah digital. Setor sampah, dapatkan reward!',
                    color: ReLoopColors.brand500,
                  ),
                  _OnboardingPage(
                    icon: Icons.qr_code_scanner,
                    title: 'Scan & Setor',
                    description: 'Scan QR code di mesin terdekat, masukkan sampah, dan otomatis dapatkan poin reward.',
                    color: ReLoopColors.statusOnline,
                  ),
                  _OnboardingPage(
                    icon: Icons.wallet,
                    title: 'Kumpulkan & Cairkan',
                    description: 'Kumpulkan reward dari setiap setoran dan cairkan kapan saja ke rekening atau e-wallet Anda.',
                    color: ReLoopColors.statusFull,
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(24),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  if (!_isLastPage)
                    TextButton(
                      onPressed: () {
                        _controller.animateToPage(
                          2,
                          duration: const Duration(milliseconds: 400),
                          curve: Curves.easeInOut,
                        );
                      },
                      child: const Text(
                        'Lewati',
                        style: TextStyle(color: ReLoopColors.muted),
                      ),
                    )
                  else
                    const SizedBox(width: 80),
                  SmoothPageIndicator(
                    controller: _controller,
                    count: 3,
                    effect: ExpandingDotsEffect(
                      activeDotColor: ReLoopColors.brand500,
                      dotColor: ReLoopColors.border,
                      dotHeight: 8,
                      dotWidth: 8,
                      expansionFactor: 3,
                    ),
                  ),
                  SizedBox(
                    width: 80,
                    child: _isLastPage
                        ? TextButton(
                            onPressed: _complete,
                            child: const Text(
                              'Mulai',
                              style: TextStyle(
                                color: ReLoopColors.brand600,
                                fontWeight: FontWeight.w700,
                                fontSize: 15,
                              ),
                            ),
                          )
                        : TextButton(
                            onPressed: () {
                              _controller.nextPage(
                                duration: const Duration(milliseconds: 400),
                                curve: Curves.easeInOut,
                              );
                            },
                            child: const Text(
                              'Lanjut',
                              style: TextStyle(
                                color: ReLoopColors.brand600,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OnboardingPage extends StatelessWidget {
  final IconData icon;
  final String title;
  final String description;
  final Color color;

  const _OnboardingPage({
    required this.icon,
    required this.title,
    required this.description,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 120,
            height: 120,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: color, size: 56),
          ),
          const SizedBox(height: 40),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w800,
              color: ReLoopColors.foreground,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            description,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 15,
              color: ReLoopColors.muted,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}
