# Mesutxho Firebase kurulumu

## Kimlik doğrulama ve gizlilik

- Firebase Authentication'da **Google** ve **Apple** sağlayıcılarını etkinleştirin. Misafir erişimi yerel ve anonimdir; Firebase Anonymous sağlayıcısı kullanılmaz. Apple sağlayıcısı için Apple Developer bilgilerini Firebase Console'da yapılandırın; özel anahtarları depoya eklemeyin.
- Oturum kayıtları yalnızca kullanıcı genişletilmiş gizlilik bildirimindeki açık onayı verdiğinde yazılır. Onay vermeyen ziyaretçi misafir olarak siteye erişebilir ve oturum kaydı oluşturulmaz.
- Güvenlik denetimi, mümkün olduğunda içeriği göstermeden önce sunucu tarafında IP ve kullanıcı banlarını kontrol eder. Callable Function yanıt vermezse site kilitlenmez ve kullanıcı devam edebilir; bu fail-open davranışı servis kesintilerinde ban denetiminin geçici olarak uygulanamayabileceği anlamına gelir.
- Onaylı kayıtlar yeni `visits` koleksiyonuna yazılır; önceki `sessions` kayıtları da admin panelinde tarihçe olarak gösterilir. IP adresi, yaklaşık ülke/şehir/bölge/posta kodu/enlem-boylam/zaman dilimi/ISP, giriş yöntemi, UID/e-posta/ad/profil fotoğrafı ve kimlik sağlayıcısı verirse telefon numarası, cihaz/model, işletim sistemi/sürümü, tarayıcı/sürümü, User-Agent, ekran boyutları, dil, referrer ve oturum süresi saklanır. Google/Apple parolaları hiçbir zaman alınmaz ya da kaydedilmez. IP için tarayıcı önce ipify'ı, hata durumunda ipapi.co'yu dener; sunucu konum için ipapi.co/ipwho.is yedeklerini kullanır. Her dış istek üç saniyede zaman aşımına uğrar; sağlayıcılar başarısız olsa da kayıt `Bilinmeyen IP`/bilinmeyen konumla devam eder. Erişim denetimi sunucu IP'sini alıp IP/kullanıcı banlarını kontrol eder; denetim servisine ulaşılamadığında statik site erişimi açık kalır.
- Admin panelindeki aktif kullanıcı sayısı, son beş dakika içindeki `lastSeen` değerlerine göre UID/oturum bazında hesaplanır. `lastSeen`, sayfada yeni kullanıcı etkileşimi varken süre güncelleme callable'ı aracılığıyla yenilenir.
- Ziyaret belgeleri `visits` (ve eski kayıtlar `sessions`) koleksiyonunda 90 günlük `expiresAt` TTL alanıyla tutulur. TTL'yi her iki collection group için etkinleştirin. Süre güncellemeleri oturuma özel gizli token ile doğrulanır. TTL silme işlemi tam zamanında çalışmayabilir. IP ve kullanıcı ban kayıtları otomatik olarak sona ermez; panelden kaldırılmalıdır.
- Firestore güvenlik kuralları ziyaret, ban ve IP-ban kayıtlarına istemciden yazılmasını engeller. Ban ve ziyaret yazımları `functions/index.js` içindeki Callable Functions üzerinden yapılır; admin okuması yönetici hesabıyla sınırlıdır.
- Yönetici e-postası hem `firebase-config.js`, `firestore.rules` hem de `functions/index.js` içinde `mes223ut@gmail.com` olmalıdır.
- Firebase proje yöneticileri veritabanına ve sunucu loglarına altyapı erişimi sağlayabilir. Erişimi Google Cloud IAM ile sınırlayın ve veri sorumlusu/yasal yükümlülükleriniz için kendi gizlilik metninizi hazırlayın. Bu açıklama hukuki danışmanlık değildir.

## Yayınlama

1. Firebase Console'da Authentication'ı başlatın; Google ve Apple giriş sağlayıcılarını etkinleştirin. Geliştirme ve dağıtım alan adlarını **Authorized domains** listesine ekleyin. Google, Apple, yerel misafir, onay, log, ban ve ban kaldırma akışlarını test edin.
2. Firestore veritabanını oluşturun.
3. Node.js 22 ve Firebase CLI kurulu ortamda proje kökünden Functions bağımlılıklarını yükleyin:

   ```powershell
   Set-Location functions
   npm install
   Set-Location ..
   ```

4. Firestore kurallarını, Hosting'i ve Callable Functions'ı dağıtın:

   ```powershell
   firebase deploy --project mesutxo --only firestore:rules,functions,hosting
   ```

   Cloud Functions dağıtımı için Firebase projesinde faturalandırma/Blaze planı gerekebilir.

5. Firestore TTL bölümünde `visits` ve eski `sessions` koleksiyon grupları için `expiresAt` alanında TTL'yi etkinleştirin. TTL ayarı Firebase Console'da veya şu komutlarla yapılabilir:

   ```powershell
   gcloud firestore fields ttls update expiresAt --collection-group=sessions --database="(default)" --enable-ttl --project=mesutxo
   gcloud firestore fields ttls update expiresAt --collection-group=visits --database="(default)" --enable-ttl --project=mesutxo
   ```

6. `https://mesutxo.web.app/` ve `https://mesutxo.web.app/admin.html` adreslerinde Google, Apple, misafir, onay, log, ban ve ban kaldırma akışlarını test edin.

IP engeli sayfa açılırken ve açık sekmede 30 saniyelik aralıklarla Callable Function üzerinden kontrol edilir. Firebase Hosting bu projede statik HTML/CSS/JS sunar; bu nedenle IP engeli tarayıcı arayüzünü gizleyip uygulama erişimini durdurur ancak statik dosyaların HTTP yanıtını ağ katmanında engellemez. Statik dosya indirmesini de engellemek gerekiyorsa Hosting önüne IP denetimi uygulayan Cloud Run/proxy gibi sunucu taraflı bir katman koyun.

## Yerel önizleme

ES module importları `file://` üzerinden çalışmaz. Yerel bir HTTPS/localhost sunucusu kullanın:

```powershell
python -m http.server 8080
```

`localhost` alan adını Firebase Authentication yetkili alan adlarına ekleyin. Callable Functions'ı yerelde çalıştırmak için Firebase Emulator Suite yapılandırın; canlı Firebase projesine deploy edilmemiş Functions çağrıları başarısız olur.
