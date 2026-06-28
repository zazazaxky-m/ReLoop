import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_client.dart';
import '../../theme/colors.dart';

class PromoCarousel extends StatefulWidget {
  const PromoCarousel({super.key});

  @override
  State<PromoCarousel> createState() => _PromoCarouselState();
}

class _PromoCarouselState extends State<PromoCarousel> {
  final PageController _controller = PageController();
  List<_PromoSlide> _slides = const [];
  int _index = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final response = await context.read<ApiClient>().get(
        '/api/public/hero-slides',
      );
      final data = response.data as Map<String, dynamic>;
      final slides = (data['slides'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(_PromoSlide.fromJson)
          .where((slide) => slide.imageUrl.isNotEmpty)
          .toList();
      if (!mounted || slides.isEmpty) return;
      setState(() => _slides = slides);
      _startTimer();
    } catch (_) {
      // Konten utama tetap dapat dipakai ketika banner belum tersedia.
    }
  }

  void _startTimer() {
    _timer?.cancel();
    if (_slides.length < 2) return;
    _timer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!_controller.hasClients) return;
      _controller.animateToPage(
        (_index + 1) % _slides.length,
        duration: const Duration(milliseconds: 420),
        curve: Curves.easeOutCubic,
      );
    });
  }

  Future<void> _open(_PromoSlide slide) async {
    final href = slide.href.trim();
    if (href.isEmpty) return;
    if (href.startsWith('http://') || href.startsWith('https://')) {
      await launchUrl(Uri.parse(href), mode: LaunchMode.externalApplication);
      return;
    }
    if (mounted) context.push(href);
  }

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.sizeOf(context).width;
    final bannerHeight = screenWidth / 2.4;

    return SizedBox(
      height: bannerHeight,
      child: OverflowBox(
        alignment: Alignment.center,
        minWidth: screenWidth,
        maxWidth: screenWidth,
        minHeight: bannerHeight,
        maxHeight: bannerHeight,
        child: SizedBox(
          width: screenWidth,
          height: bannerHeight,
          child: Stack(
            children: [
              Positioned.fill(
                child: _slides.isEmpty
                    ? const _PromoPlaceholder()
                    : PageView.builder(
                        controller: _controller,
                        itemCount: _slides.length,
                        onPageChanged: (value) =>
                            setState(() => _index = value),
                        itemBuilder: (context, index) {
                          final slide = _slides[index];
                          return Semantics(
                            button: slide.href.isNotEmpty,
                            label: slide.title,
                            child: InkWell(
                              onTap: () => _open(slide),
                              child: CachedNetworkImage(
                                imageUrl: slide.imageUrl,
                                fit: BoxFit.cover,
                                placeholder: (_, _) => ColoredBox(
                                  color: context.reloopBrandSoftStrong,
                                ),
                                errorWidget: (_, _, _) =>
                                    const _PromoPlaceholder(),
                              ),
                            ),
                          );
                        },
                      ),
              ),
              if (_slides.length > 1)
                Positioned(
                  right: 14,
                  bottom: 9,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: .28),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Row(
                      children: List.generate(
                        _slides.length,
                        (index) => AnimatedContainer(
                          duration: const Duration(milliseconds: 220),
                          margin: const EdgeInsets.symmetric(horizontal: 2),
                          width: index == _index ? 12 : 5,
                          height: 5,
                          decoration: BoxDecoration(
                            color: index == _index
                                ? Colors.white
                                : Colors.white54,
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
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

class _PromoPlaceholder extends StatelessWidget {
  const _PromoPlaceholder();

  @override
  Widget build(BuildContext context) {
    return const DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF176333), Color(0xFF249A4D)],
        ),
      ),
      child: Center(
        child: Icon(Icons.recycling_rounded, color: Colors.white54, size: 52),
      ),
    );
  }
}

class _PromoSlide {
  const _PromoSlide({
    required this.title,
    required this.imageUrl,
    required this.href,
  });

  final String title;
  final String imageUrl;
  final String href;

  factory _PromoSlide.fromJson(Map<String, dynamic> json) {
    final rawImageUrl = json['imageUrl']?.toString().trim() ?? '';
    return _PromoSlide(
      title: json['title']?.toString() ?? 'Program ReLoop',
      imageUrl: _resolveImageUrl(rawImageUrl),
      href: json['href']?.toString() ?? '',
    );
  }
}

String _resolveImageUrl(String value) {
  if (value.isEmpty ||
      value.startsWith('http://') ||
      value.startsWith('https://')) {
    return value;
  }

  final base = ApiClient.baseUrl.replaceFirst(RegExp(r'/+$'), '');
  final path = value.startsWith('/') ? value : '/$value';
  return '$base$path';
}
