# ReLoop Mobile - Implementation Plan Phase 6+

## Overview
Implementation plan untuk semua fitur tambahan yang belum ada di mobile app ReLoop.

**Total Estimated Time:** ~18-22 weeks  
**Total Features:** 28 features + technical improvements

---

## Phase 1: Core User Experience (Week 1-3)
**Goal:** Improve daily usability dengan offline support dan better navigation

### 1.1 Offline Mode & Data Caching
**Estimasi:** 4-5 hari

#### Features
- [ ] Cache dashboard data (balance, sessions, campaigns)
- [ ] Cache wallet history
- [ ] Sync saat online kembali
- [ ] Show "last updated" timestamp
- [ ] Queue actions saat offline (submit trash bag, scan results)

#### Dependencies
- `hive` - local database
- `connectivity_plus` - network status detection

#### Files to Create
- `lib/services/offline_service.dart`
- `lib/services/sync_service.dart`
- `lib/providers/connectivity_provider.dart`

#### Files to Modify
- `pubspec.yaml` - add dependencies
- `lib/main.dart` - initialize Hive
- `lib/core/api_client.dart` - retry logic + offline queue
- `lib/features/dashboard/user_dashboard_screen.dart` - cache data
- `lib/features/wallet/wallet_screen.dart` - cache data

---

### 1.2 Search & Filter
**Estimasi:** 2-3 hari

#### Features
- [ ] Search mesin di map screen
- [ ] Filter campaign by type/status
- [ ] Filter wallet history by date range
- [ ] Search pickup tasks

#### Files to Create
- `lib/shared/widgets/search_bar.dart`
- `lib/shared/widgets/filter_chip.dart`

#### Files to Modify
- `lib/features/map/map_screen.dart` - add search
- `lib/features/campaigns/campaigns_screen.dart` - add filter
- `lib/features/wallet/wallet_screen.dart` - add date filter
- `lib/features/pickup/pickup_screen.dart` - add search

---

### 1.3 Session Detail Screen
**Estimasi:** 2 hari

#### Features
- [ ] View deposit items dengan AI detection results
- [ ] View machine info
- [ ] View reward breakdown
- [ ] Report issue per session

#### API Integration
- `GET /api/sessions/:id` - session detail
- `GET /api/sessions/:id/items` - deposit items

#### Files to Create
- `lib/features/session/session_detail_screen.dart`
- `lib/features/session/deposit_item_card.dart`

#### Files to Modify
- `lib/core/router.dart` - add route
- `lib/features/dashboard/user_dashboard_screen.dart` - navigate to detail
- `lib/features/wallet/wallet_screen.dart` - navigate from history

---

### 1.4 Campaign Detail Screen
**Estimasi:** 2 hari

#### Features
- [ ] View campaign description & rules
- [ ] Join/leave campaign
- [ ] View progress (untuk gamified campaigns)
- [ ] Share campaign

#### API Integration
- `GET /api/campaigns/:id` - campaign detail
- `POST /api/campaigns/:id/join` - join campaign
- `DELETE /api/campaigns/:id/leave` - leave campaign

#### Files to Create
- `lib/features/campaigns/campaign_detail_screen.dart`
- `lib/features/campaigns/campaign_progress_bar.dart`

#### Files to Modify
- `lib/core/router.dart` - add route
- `lib/features/campaigns/campaigns_screen.dart` - navigate to detail

---

## Phase 2: Admin Features (Week 4-6)
**Goal:** Parity dengan web admin dashboard

### 2.1 Admin Dashboard
**Estimasi:** 5-6 hari

#### Features
- [ ] Overview metrics (total users, sessions, rewards)
- [ ] Machine management (list, status, fill level)
- [ ] User management (list, suspend, verify)
- [ ] Campaign management (create, edit, delete)
- [ ] Pickup task management
- [ ] Reports (daily, weekly, monthly)

#### API Integration
- `GET /api/admin/dashboard` - metrics
- `GET /api/admin/machines` - machine list
- `GET /api/admin/users` - user list
- `GET /api/admin/campaigns` - campaign list
- `GET /api/admin/pickups` - pickup list
- `GET /api/admin/reports` - reports

#### Files to Create
- `lib/features/admin/admin_dashboard_screen.dart`
- `lib/features/admin/machine_list_screen.dart`
- `lib/features/admin/user_list_screen.dart`
- `lib/features/admin/campaign_list_screen.dart`
- `lib/features/admin/pickup_list_screen.dart`
- `lib/features/admin/reports_screen.dart`
- `lib/features/admin/widgets/metric_card.dart`
- `lib/features/admin/widgets/chart_widget.dart`

#### Files to Modify
- `lib/core/router.dart` - add admin routes
- `lib/core/auth_provider.dart` - redirect admin to admin dashboard

---

### 2.2 Superadmin Dashboard
**Estimasi:** 3-4 hari

#### Features
- [ ] All admin features +
- [ ] Organization management
- [ ] Region management
- [ ] Waste type management
- [ ] Reward rate management
- [ ] System configuration
- [ ] Audit logs

#### API Integration
- `GET /api/superadmin/organizations` - org list
- `GET /api/superadmin/regions` - region list
- `GET /api/superadmin/waste-types` - waste type list
- `GET /api/superadmin/config` - system config
- `GET /api/superadmin/audit-logs` - audit logs

#### Files to Create
- `lib/features/superadmin/superadmin_dashboard_screen.dart`
- `lib/features/superadmin/organization_list_screen.dart`
- `lib/features/superadmin/region_list_screen.dart`
- `lib/features/superadmin/waste_type_list_screen.dart`
- `lib/features/superadmin/config_screen.dart`
- `lib/features/superadmin/audit_log_screen.dart`

#### Files to Modify
- `lib/core/router.dart` - add superadmin routes
- `lib/core/auth_provider.dart` - redirect superadmin

---

## Phase 3: User Engagement (Week 7-9)
**Goal:** Increase user retention dengan features yang engaging

### 3.1 Password Reset Flow
**Estimasi:** 2 hari

#### Features
- [ ] Request password reset (email)
- [ ] Verify OTP code
- [ ] Set new password
- [ ] Success confirmation

#### API Integration
- `POST /api/auth/forgot-password` - request reset
- `POST /api/auth/verify-reset-code` - verify OTP
- `POST /api/auth/reset-password` - set new password

#### Files to Create
- `lib/features/auth/forgot_password_screen.dart`
- `lib/features/auth/verify_otp_screen.dart`
- `lib/features/auth/reset_password_screen.dart`

#### Files to Modify
- `lib/core/router.dart` - add routes
- `lib/features/auth/login_screen.dart` - add "Forgot Password" link

---

### 3.2 Notification Center
**Estimasi:** 3 hari

#### Features
- [ ] View all notifications (read/unread)
- [ ] Mark as read
- [ ] Clear all
- [ ] Navigate to related screen

#### API Integration
- `GET /api/notifications` - list notifications
- `PATCH /api/notifications/:id/read` - mark as read
- `DELETE /api/notifications/clear` - clear all

#### Files to Create
- `lib/features/notifications/notification_center_screen.dart`
- `lib/features/notifications/notification_card.dart`
- `lib/models/notification.dart`

#### Files to Modify
- `lib/core/router.dart` - add route
- `lib/features/dashboard/user_dashboard_screen.dart` - add notification icon with badge
- `lib/services/notification_service.dart` - sync with server

---

### 3.3 Edit Profile Photo
**Estimasi:** 1-2 hari

#### Features
- [ ] Upload photo dari gallery/camera
- [ ] Crop photo
- [ ] Preview before save
- [ ] Delete photo

#### API Integration
- `POST /api/user/avatar` - upload photo (multipart)
- `DELETE /api/user/avatar` - delete photo

#### Files to Modify
- `lib/features/profile/profile_screen.dart` - add photo upload
- `lib/core/models.dart` - add avatarUrl to CurrentUser

---

### 3.4 Achievement & Gamification
**Estimasi:** 4-5 hari

#### Features
- [ ] View badges earned
- [ ] Progress tracking (streaks, levels)
- [ ] Unlock notifications
- [ ] Leaderboard (optional)

#### API Integration
- `GET /api/user/achievements` - list achievements
- `GET /api/user/progress` - progress stats
- `GET /api/leaderboard` - leaderboard (optional)

#### Files to Create
- `lib/features/gamification/achievements_screen.dart`
- `lib/features/gamification/badge_card.dart`
- `lib/features/gamification/progress_screen.dart`
- `lib/features/gamification/leaderboard_screen.dart`
- `lib/models/achievement.dart`

#### Files to Modify
- `lib/core/router.dart` - add routes
- `lib/features/dashboard/user_dashboard_screen.dart` - show achievement progress
- `lib/features/profile/profile_screen.dart` - add achievements link

---

## Phase 4: Advanced Features (Week 10-13)
**Goal:** Advanced features untuk growth dan retention

### 4.1 Social Login
**Estimasi:** 3-4 hari

#### Features
- [ ] Google Sign In
- [ ] Apple Sign In (iOS only)
- [ ] Link social account ke existing account
- [ ] Unlink social account

#### Dependencies
- `google_sign_in`
- `sign_in_with_apple`

#### API Integration
- `POST /api/auth/social-login` - social login
- `POST /api/user/link-social` - link account
- `DELETE /api/user/unlink-social` - unlink account

#### Files to Create
- `lib/services/social_auth_service.dart`

#### Files to Modify
- `pubspec.yaml` - add dependencies
- `lib/features/auth/login_screen.dart` - add social login buttons
- `lib/features/auth/register_screen.dart` - add social signup
- `lib/features/profile/profile_screen.dart` - manage linked accounts

---

### 4.2 Referral System
**Estimasi:** 3 hari

#### Features
- [ ] Generate referral code
- [ ] Share referral link
- [ ] Track referral stats
- [ ] Claim referral bonus

#### API Integration
- `GET /api/user/referral` - referral code & stats
- `POST /api/user/referral/claim` - claim bonus
- `POST /api/auth/register` - add referralCode param

#### Files to Create
- `lib/features/referral/referral_screen.dart`
- `lib/features/referral/referral_stats_card.dart`

#### Files to Modify
- `lib/core/router.dart` - add route
- `lib/features/auth/register_screen.dart` - add referral code field
- `lib/features/profile/profile_screen.dart` - add referral link

---

### 4.3 Rating & Review Mesin
**Estimasi:** 2-3 hari

#### Features
- [ ] Rate mesin (1-5 stars)
- [ ] Write review
- [ ] View reviews
- [ ] Edit/delete review

#### API Integration
- `POST /api/machines/:code/rate` - submit rating
- `GET /api/machines/:code/reviews` - list reviews
- `PATCH /api/reviews/:id` - edit review
- `DELETE /api/reviews/:id` - delete review

#### Files to Create
- `lib/features/machine/rating_dialog.dart`
- `lib/features/machine/reviews_screen.dart`
- `lib/features/machine/review_card.dart`
- `lib/models/review.dart`

#### Files to Modify
- `lib/core/router.dart` - add route
- `lib/features/machine/machine_detail_screen.dart` - show rating + add review button

---

### 4.4 Localization (i18n)
**Estimasi:** 4-5 hari

#### Features
- [ ] English & Indonesian
- [ ] Language switcher
- [ ] Persist language preference
- [ ] RTL support (optional)

#### Dependencies
- `flutter_localizations`
- `intl`

#### Files to Create
- `lib/l10n/app_en.arb`
- `lib/l10n/app_id.arb`
- `lib/l10n/l10n.dart`

#### Files to Modify
- `pubspec.yaml` - add dependencies
- `lib/main.dart` - setup localization
- All screens - replace hardcoded strings with `AppLocalizations`
- `lib/features/profile/profile_screen.dart` - add language selector

---

## Phase 5: Technical Excellence (Week 14-17)
**Goal:** Improve code quality, testing, dan performance

### 5.1 Mockito Integration Tests
**Estimasi:** 5-6 hari

#### Test Coverage Target: 85%

#### Priority Tests
1. **Auth Flow**
   - [ ] Login with valid credentials
   - [ ] Login with invalid credentials
   - [ ] Register new user
   - [ ] Password reset flow
   - [ ] Biometric login

2. **Dashboard & Wallet**
   - [ ] Load dashboard data
   - [ ] Navigate to screens
   - [ ] Pull to refresh
   - [ ] Request redemption
   - [ ] View transaction history

3. **Scan Flow**
   - [ ] Scan QR code
   - [ ] Handle invalid QR
   - [ ] Resume session
   - [ ] View scan result

4. **Admin Flow**
   - [ ] View admin dashboard
   - [ ] Manage machines
   - [ ] Manage users
   - [ ] Create campaign

#### Dependencies
- `mockito`
- `build_runner`

#### Files to Create
- `test/mocks/mock_api_client.dart`
- `test/mocks/mock_auth_provider.dart`
- `test/features/auth/login_screen_test.dart` (rewrite with mocks)
- `test/features/dashboard/user_dashboard_screen_test.dart`
- `test/features/wallet/wallet_screen_test.dart`
- `test/features/scan/scan_screen_test.dart`
- `test/features/admin/admin_dashboard_screen_test.dart`

---

### 5.2 Accessibility (a11y)
**Estimasi:** 3-4 hari

#### Features
- [ ] Add Semantics to all widgets
- [ ] Screen reader support
- [ ] Keyboard navigation
- [ ] High contrast mode
- [ ] Font size scaling

#### Files to Modify
- All screens - add `Semantics` widgets
- `lib/shared/widgets/reloop_button.dart` - add semantics
- `lib/shared/widgets/reloop_card.dart` - add semantics
- `lib/shared/widgets/status_badge.dart` - add semantics
- `lib/theme/app_theme.dart` - add high contrast theme

---

### 5.3 Performance Audit & Optimization
**Estimasi:** 3-4 hari

#### Tasks
- [ ] Profile app startup time
- [ ] Optimize image loading (use `cached_network_image`)
- [ ] Lazy load lists
- [ ] Reduce widget rebuilds
- [ ] Optimize API calls (batch requests)
- [ ] Implement pagination for all lists
- [ ] Add performance monitoring

#### Dependencies
- `cached_network_image`
- `flutter_performance`

#### Files to Modify
- `pubspec.yaml` - add dependencies
- All screens with images - use `CachedNetworkImage`
- All list screens - ensure pagination
- `lib/main.dart` - add performance monitoring

---

### 5.4 CI/CD Pipeline
**Estimasi:** 2-3 hari

#### Features
- [ ] GitHub Actions workflow
- [ ] Auto build on push
- [ ] Auto test on PR
- [ ] Deploy to Firebase App Distribution
- [ ] Deploy to Play Store (production)

#### Files to Create
- `.github/workflows/build.yml`
- `.github/workflows/test.yml`
- `.github/workflows/deploy.yml`
- `fastlane/Fastfile` (optional)

---

## Phase 6: Polish & Extras (Week 18-22)
**Goal:** Final polish dan nice-to-have features

### 6.1 Home Screen Widget
**Estimasi:** 3-4 hari

#### Features
- [ ] Widget saldo di home screen
- [ ] Quick actions (scan, wallet)
- [ ] Auto refresh

#### Dependencies
- `home_widget`

#### Files to Create
- `android/app/src/main/res/layout/widget_layout.xml`
- `ios/Runner/WidgetExtension/`
- `lib/services/home_widget_service.dart`

#### Files to Modify
- `pubspec.yaml` - add dependencies
- `android/app/src/main/AndroidManifest.xml` - register widget
- `lib/features/wallet/wallet_screen.dart` - update widget on balance change

---

### 6.2 Terms & Privacy
**Estimasi:** 1 hari

#### Features
- [ ] Terms of Service screen
- [ ] Privacy Policy screen
- [ ] Accept on register

#### Files to Create
- `lib/features/legal/terms_screen.dart`
- `lib/features/legal/privacy_screen.dart`

#### Files to Modify
- `lib/core/router.dart` - add routes
- `lib/features/auth/register_screen.dart` - add checkbox
- `lib/features/profile/profile_screen.dart` - add links

---

### 6.3 About & Version
**Estimasi:** 0.5 hari

#### Features
- [ ] App version
- [ ] Build number
- [ ] Open source licenses
- [ ] Contact support

#### Files to Create
- `lib/features/about/about_screen.dart`

#### Files to Modify
- `lib/core/router.dart` - add route
- `lib/features/profile/profile_screen.dart` - add link

---

### 6.4 Chat Support
**Estimasi:** 3-4 hari

#### Features
- [ ] In-app chat dengan support team
- [ ] Send text & images
- [ ] View chat history
- [ ] Push notification untuk new message

#### Dependencies
- `firebase_database` atau `cloud_firestore`
- `image_picker`

#### API Integration
- `GET /api/support/conversations` - list conversations
- `POST /api/support/conversations` - create conversation
- `POST /api/support/messages` - send message
- `GET /api/support/conversations/:id/messages` - get messages

#### Files to Create
- `lib/features/support/chat_list_screen.dart`
- `lib/features/support/chat_screen.dart`
- `lib/features/support/message_bubble.dart`
- `lib/models/conversation.dart`
- `lib/models/message.dart`

#### Files to Modify
- `pubspec.yaml` - add dependencies
- `lib/core/router.dart` - add routes
- `lib/features/profile/profile_screen.dart` - add support link

---

### 6.5 Feature Flags
**Estimasi:** 2 hari

#### Features
- [ ] Remote config untuk toggle fitur
- [ ] A/B testing support
- [ ] Gradual rollout

#### Dependencies
- `firebase_remote_config`

#### Files to Create
- `lib/services/feature_flag_service.dart`

#### Files to Modify
- `pubspec.yaml` - add dependencies
- `lib/main.dart` - initialize remote config
- All screens - check feature flags before showing features

---

### 6.6 Background Sync
**Estimasi:** 2-3 hari

#### Features
- [ ] Sync data di background
- [ ] Periodic refresh (every 15 minutes)
- [ ] Smart sync (only when WiFi)

#### Dependencies
- `workmanager`

#### Files to Create
- `lib/services/background_sync_service.dart`

#### Files to Modify
- `pubspec.yaml` - add dependencies
- `lib/main.dart` - register background task
- `android/app/src/main/AndroidManifest.xml` - add permissions
- `ios/Runner/Info.plist` - add background modes

---

### 6.7 Force Update
**Estimasi:** 1 hari

#### Features
- [ ] Check app version on startup
- [ ] Show update dialog jika versi lama
- [ ] Force update jika critical

#### API Integration
- `GET /api/app/version` - latest version

#### Files to Create
- `lib/services/version_service.dart`
- `lib/shared/widgets/update_dialog.dart`

#### Files to Modify
- `lib/main.dart` - check version on startup

---

### 6.8 Error Boundary
**Estimasi:** 1 hari

#### Features
- [ ] Global error handling widget
- [ ] Show friendly error screen
- [ ] Report error ke Crashlytics
- [ ] Retry button

#### Files to Create
- `lib/shared/widgets/error_boundary.dart`

#### Files to Modify
- `lib/main.dart` - wrap app with ErrorBoundary

---

### 6.9 Network Indicator
**Estimasi:** 1 hari

#### Features
- [ ] Show banner saat offline
- [ ] Auto-hide saat online
- [ ] Queue actions saat offline

#### Files to Create
- `lib/shared/widgets/network_indicator.dart`

#### Files to Modify
- `lib/main.dart` - add network indicator
- `lib/providers/connectivity_provider.dart` - update status

---

### 6.10 Image Caching
**Estimasi:** 1 hari

#### Features
- [ ] Cache all network images
- [ ] Show placeholder while loading
- [ ] Show error image on failure

#### Dependencies
- `cached_network_image`

#### Files to Modify
- `pubspec.yaml` - add dependencies
- All screens with images - use `CachedNetworkImage`

---

## Summary

| Phase | Duration | Features | Priority |
|-------|----------|----------|----------|
| **Phase 1** | 3 weeks | Offline Mode, Search, Session Detail, Campaign Detail | High |
| **Phase 2** | 3 weeks | Admin Dashboard, Superadmin Dashboard | High |
| **Phase 3** | 3 weeks | Password Reset, Notification Center, Profile Photo, Gamification | High |
| **Phase 4** | 4 weeks | Social Login, Referral, Rating, Localization | Medium |
| **Phase 5** | 4 weeks | Mockito Tests, Accessibility, Performance, CI/CD | Medium |
| **Phase 6** | 5 weeks | Home Widget, Legal, About, Chat, Feature Flags, Background Sync, Force Update, Error Boundary, Network Indicator, Image Caching | Low |

**Total Estimated Time:** 18-22 weeks

---

## Dependencies to Add

```yaml
dependencies:
  # Phase 1
  hive: ^3.0.0
  hive_flutter: ^1.1.0
  connectivity_plus: ^6.0.0
  
  # Phase 4
  google_sign_in: ^6.2.0
  sign_in_with_apple: ^6.1.0
  flutter_localizations:
    sdk: flutter
  intl: ^0.19.0
  
  # Phase 5
  mockito: ^5.4.0
  build_runner: ^2.4.0
  
  # Phase 6
  home_widget: ^0.6.0
  firebase_database: ^11.0.0
  cloud_firestore: ^5.0.0
  firebase_remote_config: ^5.0.0
  workmanager: ^0.5.0
  cached_network_image: ^3.3.0

dev_dependencies:
  flutter_launcher_icons: ^0.13.0
```

---

## Next Steps

1. Review dan approve implementation plan
2. Prioritize Phase 1 (Core User Experience)
3. Start dengan Offline Mode (highest impact)
4. Weekly review untuk track progress
5. Bi-weekly demo untuk stakeholders

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Backend API belum ready | Mock API responses, coordinate dengan backend team |
| Performance issues | Profile early, optimize incrementally |
| Scope creep | Stick to plan, defer nice-to-haves |
| Testing coverage low | Write tests alongside features |
| Platform-specific bugs | Test on both Android & iOS regularly |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Test Coverage | 85% |
| App Startup Time | < 2 seconds |
| Crash Rate | < 0.1% |
| User Retention (Day 7) | > 40% |
| User Retention (Day 30) | > 20% |
| App Store Rating | > 4.5 stars |
