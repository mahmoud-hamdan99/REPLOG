# REPLOG — Product Requirements & Development Specification

**Version:** 1.0  
**Product type:** Personal Fitness & Workout Tracking PWA  
**Initial release:** Single-user, local-first  
**Primary platform:** iPhone Home Screen PWA  
**Hosting:** GitHub Pages  
**Budget:** Zero-cost tools and services

## 1. Product Vision

REPLOG is a premium personal fitness application designed to help users plan workouts, record every exercise and set, monitor strength progression, track body measurements, and document physical transformations.

The primary objective is to make workout tracking extremely fast, intuitive, reliable, and enjoyable.

The application must be designed as a real product, not a generic fitness dashboard.

## 2. Target User

A person who regularly trains at the gym and wants to:

- Build and manage personalized workout plans.
- Follow weekly training schedules.
- Record weights and repetitions for every set.
- Compare performance with previous sessions.
- Track body weight and physical measurements.
- Monitor strength progression.
- Record personal records.
- Analyze training history.
- Save optional transformation photos.

## 3. Confirmed Product Decisions

- Single-user application in Version 1.
- Optional personal profile.
- Built-in exercise library and custom exercises.
- Simple and advanced workout tracking.
- Manual workout entry with intelligent suggestions.
- Optional progress photos.
- Kilograms and pounds, configurable.
- Fixed weekly schedules and flexible workouts.
- English as the primary language.
- Arabic as the secondary language.
- Complete LTR and RTL support.
- Dark mode, light mode and system theme.
- Local-only data storage in Version 1.
- No paid dependencies or services.

## 4. Main Application Modules

### 4.1 Dashboard

Display:
- Current body weight.
- Weight change.
- Weekly workout count.
- Workout consistency.
- Next scheduled workout.
- Recent personal records.
- Latest body measurements.
- Quick-start workout action.
- Recent training activity.

All statistics must be calculated from actual stored records.

### 4.2 Workout Planner

Allow users to:
- Create, edit, duplicate and archive workout plans.
- Create unlimited routines within available storage.
- Add exercises from the exercise library.
- Create custom exercises.
- Reorder exercises.
- Configure target sets and reps.
- Configure rest periods.
- Add exercise notes.
- Assign routines to weekdays.
- Create flexible unscheduled routines.
- Duplicate existing plans.

Scheduled and flexible workout plans must both be supported.

### 4.3 Exercise Library

Provide a built-in exercise catalog with categories:

- Chest
- Back
- Shoulders
- Biceps
- Triceps
- Forearms
- Quadriceps
- Hamstrings
- Glutes
- Calves
- Abs
- Full body

Support filtering by:
- Muscle group.
- Equipment.
- Exercise type.
- Movement pattern.

Each exercise should include:
- English name.
- Arabic name.
- Target muscles.
- Secondary muscles.
- Equipment.
- Instructions.
- Exercise classification.
- Optional illustration.

Allow users to create and manage their own exercises.

### 4.4 Active Workout Tracker

This is the most important application module.

Prioritize speed and usability during actual gym sessions.

Features:
- Start a workout from a saved routine.
- Start an unscheduled workout.
- Automatically load planned exercises and sets.
- Display previous performance beside current input fields.
- Record weight and repetitions independently for every set.
- Mark sets as complete.
- Add and remove sets.
- Add warm-up sets.
- Add working sets.
- Support supersets.
- Record optional RPE and RIR.
- Start and manage rest timers.
- Add exercise notes.
- Pause and resume workouts.
- Skip or reorder exercises.
- Finish and save workouts.
- Track workout duration and volume.

Persist active workout progress automatically.

The application must protect active sessions against accidental navigation, refreshes and temporary interruptions.

Provide a simple logging interface by default, with optional advanced tracking controls.

### 4.5 Intelligent Suggestions

Display previous performance when an exercise is selected.

Provide optional recommendations based on historical performance.

Examples:
- Previous weights and repetitions.
- Suggested next-session weight.
- Suggested repetitions.
- New personal record notifications.
- Performance comparisons.

Never automatically modify workout plans without user confirmation.

Clearly distinguish actual records from calculated estimates.

### 4.6 Workout History

Provide:
- Chronological workout history.
- Workout details.
- Exercise-level performance history.
- Completed sets.
- Duration.
- Notes.
- Historical plan references.

Editing a workout template must never silently modify completed workout history.

### 4.7 Body Measurements

Track:
- Body weight.
- Height.
- Chest.
- Waist.
- Shoulders.
- Neck.
- Left and right biceps.
- Left and right forearms.
- Left and right thighs.
- Calves.
- Body fat percentage.
- Custom measurements.

Allow:
- Adding measurements.
- Editing entries.
- Deleting entries.
- Historical comparisons.
- Progress charts.
- Date-based filtering.

Support kg/lb and cm/in where applicable.

### 4.8 Progress Photos

Optional functionality.

Allow users to:
- Upload or select photos.
- Record dates.
- Categorize front, side and back photos.
- View a chronological gallery.
- Compare two dates.
- Delete photos.

Photos must remain locally stored.

Use IndexedDB Blob storage or an appropriate local file storage abstraction.

Do not upload photos to external services.

### 4.9 Progress Analytics

Calculate and display:
- Exercise strength progression.
- Personal records.
- Estimated one-rep max.
- Total training volume.
- Total sets and repetitions.
- Weekly and monthly workout frequency.
- Muscle-group training distribution.
- Body weight trends.
- Measurement trends.

Provide time filters:
- 7 days.
- 30 days.
- 3 months.
- 6 months.
- 1 year.
- All time.

Do not fabricate missing data or misleading progress trends.

### 4.10 Personal Records

Automatically identify records from completed workout data.

Support:
- Maximum weight.
- Maximum repetitions at a given weight.
- Estimated one-rep max.
- Highest recorded volume.
- Personal record history.

Avoid comparing incompatible exercise variations or equipment configurations without making the distinction clear.

### 4.11 Settings

Include:
- Language selection.
- Theme selection.
- Weight units.
- Measurement units.
- Default rest timer.
- Workout preferences.
- Profile management.
- Data export.
- Data import.
- Reset application data.

## 5. Visual Design Requirements

Create a premium, modern fitness product.

Suggested visual direction:
- Dark charcoal background.
- Lime green accent.
- Clean typography.
- Minimalist icons.
- Large readable statistics.
- Elegant charts.
- Carefully designed cards.
- Consistent spacing.
- Subtle animations.
- Excellent visual hierarchy.

Provide a complete light theme and dark theme.

Avoid generic dashboard templates and excessive decoration.

Mobile-first design is mandatory.

Optimize specifically for modern iPhone screens, including Pro Max devices.

Support:
- Safe areas.
- iOS home indicator spacing.
- Comfortable touch targets.
- Responsive layouts.
- Bottom navigation.
- Smooth scrolling.
- Clear feedback and confirmation states.

## 6. Internationalization

English is the default language.

Arabic is fully supported.

Requirements:
- Centralized translations.
- Complete translation coverage.
- Correct RTL/LTR switching.
- Correct directional icons and layouts.
- Natural Arabic terminology.
- Appropriate Arabic fonts.
- Persist selected language.
- No hardcoded user-facing strings.

## 7. Local-First Architecture

Version 1 must operate without a backend.

Use:
- IndexedDB for structured application records and photo blobs.
- LocalStorage for lightweight preferences.
- A repository abstraction for all persistent data.
- Separate business logic from storage implementation.
- Database versioning and migration mechanisms.

Do not access IndexedDB directly from UI components.

Prepare the storage architecture for a future cloud synchronization implementation.

Future cloud integration may use Supabase PostgreSQL, Authentication, Storage and Realtime, but these are NOT required in Version 1.

## 8. Data Protection

Implement:
- Automatic local persistence.
- JSON export.
- JSON import.
- Import validation.
- Confirmation before destructive actions.
- Error handling.
- Database migration support.
- Backup instructions.
- Protection against accidental overwrites.

Clearly explain that local browser storage is not guaranteed permanent and that backups are necessary.

## 9. PWA Requirements

The application must:
- Be installable through Safari Add to Home Screen.
- Include a valid web app manifest.
- Include suitable app icons.
- Include Apple touch icon metadata.
- Support standalone display mode.
- Use HTTPS.
- Include a service worker.
- Cache essential application assets.
- Provide offline functionality.
- Handle application updates correctly.

Do not claim that unsupported native iOS capabilities are available.

## 10. Technology Requirements

Use:
- Angular.
- TypeScript.
- Standalone components.
- Modern CSS.
- IndexedDB.
- LocalStorage.
- GitHub.
- GitHub Actions.
- GitHub Pages.

Use stable compatible versions and open-source dependencies.

All essential functionality must remain available without paid services.

## 11. GitHub Pages Deployment

Prepare the application for deployment to:

https://USERNAME.github.io/REPOSITORY-NAME/

Requirements:
- Correct Angular base path configuration.
- Correct asset paths.
- GitHub Actions deployment workflow.
- GitHub Pages compatibility.
- SPA routing compatibility.
- PWA compatibility under repository subpaths.
- HTTPS.
- Automatic deployment on approved pushes to the main branch.

Include complete Windows PowerShell instructions.

## 12. Future Architecture

Keep the code ready for a future Version 2.

Potential additions:
- User authentication.
- Cloud database.
- Multi-device synchronization.
- Multiple devices.
- Cloud backups.
- Optional family or trainer sharing.
- Secure owner administration.

Do not implement these in Version 1.

## 13. Quality Assurance

Before release:
- Run production builds.
- Run automated tests.
- Check TypeScript errors.
- Check routing.
- Check data persistence.
- Check database migrations.
- Check import/export.
- Check mobile responsiveness.
- Check Arabic and English layouts.
- Check light and dark themes.
- Check offline operation.
- Check GitHub Pages deployment paths.

Clearly distinguish tested functionality from functionality that could not be tested.

## 14. Definition of Done

REPLOG Version 1 is complete when:

1. The application works locally on Windows.
2. All main modules are functional.
3. Workout plans can be created and saved.
4. Completed workouts persist correctly.
5. Previous exercise performance is available.
6. Body measurements can be recorded and charted.
7. Optional progress photos work.
8. Analytics use actual stored data.
9. English and Arabic work correctly.
10. Light and dark themes work.
11. Data export and import work.
12. The PWA works offline after initial loading.
13. The application installs on an iPhone through Safari.
14. GitHub Pages deployment works.
15. No paid infrastructure is required.

The final application must feel like a premium fitness product, be easy to use during real workouts, and preserve user data reliably.