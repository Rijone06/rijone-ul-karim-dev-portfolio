import { initializeApp } from "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js";

// Web app config (Firebase console → Project settings). Inlined so one fewer local import — opening index.html as a file often broke ./firebase-config.js.
const firebaseConfig = {
  apiKey: "AIzaSyBjpOc9jZ2Hy4uyxVR1saBZCDcs4UC4TOA",
  authDomain: "rijone-ul-karim.firebaseapp.com",
  projectId: "rijone-ul-karim",
  storageBucket: "rijone-ul-karim.firebasestorage.app",
  messagingSenderId: "1043391642862",
  appId: "1:1043391642862:web:03d26150848a432f5947ff",
};

// Paste your Firebase Auth “User UID” (Authentication → Users) to unlock “Admin remove” on reviews.
// Must match the string in firestore.rules (REPLACE_WITH_PORTFOLIO_ADMIN_FIREBASE_UID → same value).
const PORTFOLIO_ADMIN_FIREBASE_UID = "";

function isPortfolioAdminAccount(user) {
  var id =
    typeof PORTFOLIO_ADMIN_FIREBASE_UID === "JDsE32FGefOvzFYehG0KWPbnY3C2"
      ? PORTFOLIO_ADMIN_FIREBASE_UID.trim()
      : "";
  if (!user || id.length < 10 || id.includes("REPLACE")) return false;
  return user.uid === id;
}

function configIsReady(cfg) {
  if (!cfg || !cfg.apiKey || !cfg.projectId) return false;
  const bad = (v) => typeof v === "string" && (v.includes("YOUR_") || v === "");
  return !bad(cfg.apiKey) && !bad(cfg.projectId);
}

function isGmailAddress(email) {
  if (!email) return false;
  const e = email.toLowerCase();
  return e.endsWith("@gmail.com") || e.endsWith("@googlemail.com");
}

function maskEmail(email) {
  if (!email) return "";
  const parts = email.split("@");
  if (parts.length !== 2) return email;
  const local = parts[0];
  const domain = parts[1];
  const masked = local.length <= 1 ? `${local || "?"}*` : `${local[0]}***`;
  return `${masked}@${domain}`;
}

function initialsFrom(displayName, email) {
  if (displayName && String(displayName).trim())
    return String(displayName).trim()[0].toUpperCase();
  if (email && email[0]) return email[0].toUpperCase();
  return "?";
}

function createFallbackAvatar(displayName, email) {
  const span = document.createElement("span");
  span.className = "rating-avatar-initial";
  span.textContent = initialsFrom(displayName, email);
  return span;
}

function updateSessionChip(user, sessionPhoto, sessionInitial) {
  if (!sessionPhoto || !sessionInitial) return;

  sessionPhoto.onload = function () {
    sessionPhoto.classList.remove("hidden");
    sessionInitial.classList.add("hidden");
  };

  sessionPhoto.onerror = function () {
    sessionPhoto.classList.add("hidden");
    sessionInitial.classList.remove("hidden");
    sessionPhoto.removeAttribute("src");
    sessionInitial.textContent = initialsFrom(user.displayName, user.email);
  };

  const url = user.photoURL && String(user.photoURL).trim();

  sessionInitial.textContent = initialsFrom(user.displayName, user.email);

  if (url) {
    sessionPhoto.classList.add("hidden");
    sessionInitial.classList.remove("hidden");
    sessionPhoto.src = url;
  } else {
    sessionPhoto.removeAttribute("src");
    sessionPhoto.classList.add("hidden");
    sessionInitial.classList.remove("hidden");
  }
}

function appendRatingAvatar(wrapEl, row) {
  wrapEl.innerHTML = "";
  const trimmed = row.photoURL && String(row.photoURL).trim();

  if (trimmed) {
    const img = document.createElement("img");
    img.className = "rating-avatar-img";
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.src = trimmed;
    img.onerror = function () {
      wrapEl.replaceChildren(createFallbackAvatar(row.displayName, row.email));
    };
    wrapEl.appendChild(img);
  } else {
    wrapEl.appendChild(createFallbackAvatar(row.displayName, row.email));
  }
}

function renderStarRow(rating) {
  const n = Math.min(5, Math.max(0, Math.round(Number(rating) || 0)));
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= 5; i += 1) {
    const star = document.createElement("i");
    star.className = i <= n ? "ri-star-fill" : "ri-star-line";
    star.setAttribute("aria-hidden", "true");
    frag.appendChild(star);
  }
  return frag;
}

function el(id) {
  return document.getElementById(id);
}

function setVisible(node, show) {
  if (!node) return;
  node.classList.toggle("hidden", !show);
}

let auth;
let db;

function initRatingsUi() {
  try {
  const banner = el("ratings-config-banner");
  const avgNum = el("avg-rating");
  const avgStars = el("avg-stars");
  const countMeta = el("ratings-count");
  const list = el("ratings-list");
  const emptyState = el("ratings-empty");
  const signedOut = el("ratings-signed-out");
  const signedIn = el("ratings-signed-in");
  const authHint = el("ratings-auth-hint");
  const googleBtn = el("ratings-google-btn");
  const signOutBtn = el("ratings-sign-out");
  const userEmailEl = el("ratings-user-email");
  const form = el("ratings-form");
  const commentEl = el("rating-comment");
  const formStatus = el("ratings-form-status");
  const sessionPhoto = el("ratings-session-photo");
  const sessionInitial = el("ratings-session-initial");
  const deleteMineBtn = el("ratings-delete-my-review");

  function showMisconfigBanner() {
    if (banner) {
      banner.classList.remove("hidden");
      banner.innerHTML =
        "<strong>Ratings are not connected yet.</strong> Set your Firebase web config in <code>js/ratings.js</code> (<code>firebaseConfig</code>), enable Google sign-in and Firestore, then publish <code>firestore.rules</code>. " +
        "<strong>Use your live GitHub Pages URL</strong> or <code>http://localhost</code> — not a <code>file:///</code> path.";
    }
  }

  if (!configIsReady(firebaseConfig)) {
    showMisconfigBanner();
    setVisible(signedOut, true);
    setVisible(signedIn, false);
    if (avgNum) avgNum.textContent = "—";
    if (countMeta) countMeta.textContent = "Add Firebase keys to enable sign-in";
    if (emptyState) emptyState.classList.add("hidden");
    if (googleBtn) {
      googleBtn.removeAttribute("disabled");
      googleBtn.addEventListener("click", function onGoogleClickNoConfig() {
        showMisconfigBanner();
        if (banner) {
          banner.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        if (authHint) {
          authHint.textContent =
            "Edit the firebaseConfig object in js/ratings.js, then refresh. Open the site from GitHub Pages or http://localhost, not by double-clicking the HTML file.";
          authHint.classList.remove("hidden");
        }
      });
    }
    window.__portfolioRatingsReady = true;
    return;
  }

  let app;
  try {
    app = initializeApp(firebaseConfig);
  } catch (initErr) {
    showMisconfigBanner();
    if (banner && initErr) {
      banner.innerHTML +=
        " <span class=\"ratings-banner-error\">" +
        String(initErr.message || initErr).replace(/</g, "&lt;") +
        "</span>";
    }
    if (countMeta) countMeta.textContent = "Firebase failed to initialize — check the console.";
    return;
  }

  auth = getAuth(app);
  db = getFirestore(app);

  getRedirectResult(auth).catch(function () {
    /* no pending redirect */
  });

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  let selectedRating = 0;
  const starInput = el("rating-star-input");
  const pickers = document.querySelectorAll("[data-rating-star]");

  function syncStarPicker() {
    pickers.forEach((btn) => {
      const v = Number(btn.getAttribute("data-rating-star"));
      const on = selectedRating > 0 && v <= selectedRating;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (starInput) starInput.value = selectedRating ? String(selectedRating) : "";
  }

  pickers.forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedRating = Number(btn.getAttribute("data-rating-star"));
      syncStarPicker();
    });
  });
  syncStarPicker();

  async function deleteRatingFor(targetDocUid) {
    var u = auth.currentUser;
    if (!db || !u || !targetDocUid) {
      if (formStatus) {
        formStatus.textContent = "Sign in to delete reviews.";
        formStatus.className = "form-status error";
      }
      return;
    }

    var ownerDeletingOwn = u.uid === targetDocUid;
    var actingAsAdmin = isPortfolioAdminAccount(u);

    if (!ownerDeletingOwn && !actingAsAdmin) {
      if (formStatus) {
        formStatus.textContent = "Only the reviewer (or site admin) can remove a review.";
        formStatus.className = "form-status error";
      }
      return;
    }

    if (ownerDeletingOwn && !actingAsAdmin && !isGmailAddress(u.email)) {
      if (formStatus) {
        formStatus.textContent = "Use your Gmail-signed account to manage your review.";
        formStatus.className = "form-status error";
      }
      return;
    }

    var confirmMsg = ownerDeletingOwn
      ? "Delete your published review permanently from this portfolio?"
      : "Remove this client’s review as site admin? This cannot be undone.";

    if (!confirm(confirmMsg)) return;

    if (formStatus) {
      formStatus.textContent = ownerDeletingOwn ? "Deleting your review…" : "Removing review…";
      formStatus.className = "form-status";
    }

    try {
      await deleteDoc(doc(db, "ratings", targetDocUid));
      if (ownerDeletingOwn) {
        selectedRating = 0;
        syncStarPicker();
        if (commentEl) commentEl.value = "";
      }
      if (formStatus) {
        formStatus.textContent = ownerDeletingOwn
          ? "Your review has been removed."
          : "Review removed (admin).";
        formStatus.className = "form-status success";
      }
      clearAuthHint();
    } catch (err) {
      if (formStatus) {
        formStatus.textContent =
          err.message ||
          "Delete failed — check Firestore rules (owner delete + matching admin UID) and publish.";
        formStatus.className = "form-status error";
      }
    }
  }

  if (deleteMineBtn) {
    deleteMineBtn.addEventListener("click", function () {
      var u = auth.currentUser;
      if (u && isGmailAddress(u.email)) deleteRatingFor(u.uid);
      else if (formStatus) {
        formStatus.textContent = "Sign in with Gmail to remove your review.";
        formStatus.className = "form-status error";
      }
    });
  }

  async function loadMyRating(uid) {
    if (!db || !uid) return;
    const snap = await getDoc(doc(db, "ratings", uid));
    if (!snap.exists()) return;
    const data = snap.data();
    if (typeof data.rating === "number" && data.rating >= 1 && data.rating <= 5) {
      selectedRating = data.rating;
      syncStarPicker();
    }
    if (commentEl && typeof data.comment === "string") {
      commentEl.value = data.comment;
    }
  }

  function showGmailOnlyMessage() {
    if (authHint) {
      authHint.textContent =
        "Ratings require a personal Gmail address (@gmail.com). Sign out and try another Google account if needed.";
      authHint.classList.remove("hidden");
    }
  }

  function clearAuthHint() {
    if (authHint) {
      authHint.textContent = "";
      authHint.classList.add("hidden");
    }
  }

  onAuthStateChanged(auth, async (user) => {
    clearAuthHint();
    if (!user) {
      setVisible(signedOut, true);
      setVisible(signedIn, false);
      selectedRating = 0;
      syncStarPicker();
      if (commentEl) commentEl.value = "";
      if (sessionPhoto) {
        sessionPhoto.removeAttribute("src");
        sessionPhoto.classList.add("hidden");
      }
      if (sessionInitial) {
        sessionInitial.textContent = "?";
        sessionInitial.classList.remove("hidden");
      }
      if (signedOut) signedOut.setAttribute("aria-hidden", "false");
      if (signedIn) signedIn.setAttribute("aria-hidden", "true");
      return;
    }

    if (!isGmailAddress(user.email)) {
      showGmailOnlyMessage();
      try {
        await signOut(auth);
      } catch (e) {
        /* ignore */
      }
      setVisible(signedOut, true);
      setVisible(signedIn, false);
      return;
    }

    setVisible(signedOut, false);
    setVisible(signedIn, true);
    if (signedOut) signedOut.setAttribute("aria-hidden", "true");
    if (signedIn) signedIn.setAttribute("aria-hidden", "false");
    if (userEmailEl) {
      userEmailEl.textContent = user.email || "";
    }
    updateSessionChip(user, sessionPhoto, sessionInitial);
    await loadMyRating(user.uid);
  });

  if (googleBtn) {
    googleBtn.removeAttribute("disabled");
    googleBtn.addEventListener("click", async function onGoogleClick() {
      if (location.protocol === "file:") {
        if (authHint) {
          authHint.textContent =
            "Sign-in does not work when you open the HTML file directly. Use your live site (GitHub Pages) or http://localhost — see the red banner above.";
          authHint.classList.remove("hidden");
        }
        if (banner) {
          banner.classList.remove("hidden");
          banner.innerHTML =
            "<strong>Wrong way to open this page.</strong> The address bar must start with <code>http://</code> or <code>https://</code>, not <code>file:///</code>. Push to GitHub and use your <code>username.github.io</code> link, or run a local server.";
          banner.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }
      clearAuthHint();
      if (authHint) {
        authHint.textContent = "Opening Google sign-in…";
        authHint.classList.remove("hidden");
      }
      try {
        await signInWithPopup(auth, provider);
        clearAuthHint();
      } catch (err) {
        const code = err && err.code;
        if (code === "auth/popup-closed-by-user") {
          clearAuthHint();
          return;
        }
        if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
          try {
            if (authHint) {
              authHint.textContent = "Popup blocked — continuing in the same tab…";
              authHint.classList.remove("hidden");
            }
            await signInWithRedirect(auth, provider);
            return;
          } catch (redirectErr) {
            if (authHint) {
              authHint.textContent =
                (redirectErr && redirectErr.message) ||
                "Could not start sign-in. Allow popups for this site or try another browser.";
              authHint.classList.remove("hidden");
            }
            return;
          }
        }
        clearAuthHint();
        if (authHint) {
          var msg = (err && err.message) || "Sign-in failed. Please try again.";
          if (code === "auth/unauthorized-domain") {
            msg =
              "This site's domain is not allowed in Firebase. In the Firebase console go to Authentication → Settings → Authorized domains and add this hostname.";
          }
          authHint.textContent = msg;
          authHint.classList.remove("hidden");
        }
      }
    });
  }

  if (signOutBtn) {
    signOutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
      } catch (e) {
        /* ignore */
      }
    });
  }

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const user = auth.currentUser;
      if (!user || !isGmailAddress(user.email)) {
        if (formStatus) {
          formStatus.textContent = "Please sign in with Gmail first.";
          formStatus.className = "form-status error";
        }
        return;
      }

      const r = selectedRating;
      const comment = commentEl ? commentEl.value.trim() : "";

      if (!r || r < 1 || r > 5) {
        if (formStatus) {
          formStatus.textContent = "Choose a star rating from 1 to 5.";
          formStatus.className = "form-status error";
        }
        return;
      }
      if (!comment) {
        if (formStatus) {
          formStatus.textContent = "Please write a short comment.";
          formStatus.className = "form-status error";
        }
        return;
      }

      if (formStatus) {
        formStatus.textContent = "Saving your rating...";
        formStatus.className = "form-status";
      }

      try {
        const displayName =
          (user.displayName && user.displayName.trim()) ||
          (user.email ? user.email.split("@")[0] : "Client");

        var payload = {
          email: user.email,
          displayName: displayName.slice(0, 120),
          rating: r,
          comment: comment.slice(0, 2000),
          updatedAt: serverTimestamp(),
        };
        var pUrl =
          typeof user.photoURL === "string" && user.photoURL.trim()
            ? user.photoURL.trim().slice(0, 2048)
            : null;
        if (pUrl) payload.photoURL = pUrl;

        await setDoc(doc(db, "ratings", user.uid), payload, { merge: true });

        if (formStatus) {
          formStatus.textContent = "Thank you — your rating is live on this page.";
          formStatus.className = "form-status success";
        }
      } catch (err) {
        if (formStatus) {
          formStatus.textContent =
            err.message ||
            "Could not save. Check Firestore rules and your connection.";
          formStatus.className = "form-status error";
        }
      }
    });
  }

  onSnapshot(
    query(collection(db, "ratings"), orderBy("updatedAt", "desc")),
    (snapshot) => {
      const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

      let sum = 0;
      let n = 0;
      docs.forEach((row) => {
        if (typeof row.rating === "number" && row.rating >= 1 && row.rating <= 5) {
          sum += row.rating;
          n += 1;
        }
      });

      if (avgNum) {
        avgNum.textContent = n ? (sum / n).toFixed(1) : "—";
      }
      if (avgStars) {
        avgStars.innerHTML = "";
        if (n) {
          const average = sum / n;
          avgStars.appendChild(renderStarRow(Math.round(average)));
        }
      }
      if (countMeta) {
        countMeta.textContent =
          n === 0
            ? "No verified reviews yet — add yours from the sidebar."
            : `${n} verified review${n === 1 ? "" : "s"} · live average`;
      }

      if (!list) return;
      list.innerHTML = "";
      list.setAttribute("aria-busy", "false");

      if (docs.length === 0) {
        setVisible(emptyState, true);
        return;
      }
      setVisible(emptyState, false);

      const currentUid = auth.currentUser ? auth.currentUser.uid : null;

      docs.forEach(function (row) {
        var card = document.createElement("article");
        card.className = "rating-card";

        var top = document.createElement("div");
        top.className = "rating-card__top";

        var avWrap = document.createElement("div");
        avWrap.className = "rating-avatar-wrap";
        appendRatingAvatar(avWrap, row);

        var bodyEl = document.createElement("div");
        bodyEl.className = "rating-card__body";
        var rowTop = document.createElement("div");
        rowTop.className = "rating-card__row";
        var stars = document.createElement("div");
        stars.className = "rating-stars";
        stars.setAttribute("aria-label", `${row.rating} out of 5 stars`);
        stars.appendChild(renderStarRow(row.rating));

        rowTop.appendChild(stars);

        var actionWrap = document.createElement("div");
        actionWrap.className = "rating-card__actions";

        var reviewerSignedInUid = auth.currentUser ? auth.currentUser.uid : null;
        var viewerIsPortfolioAdmin =
          auth.currentUser && isPortfolioAdminAccount(auth.currentUser);

        if (currentUid === row.id) {
          var userDel = document.createElement("button");
          userDel.type = "button";
          userDel.className = "rating-delete-btn rating-delete-btn--user";
          userDel.innerHTML =
            '<i class="ri-delete-bin-line" aria-hidden="true"></i> Delete my review';
          userDel.title = "Remove your rating and comment";
          userDel.addEventListener("click", function () {
            deleteRatingFor(row.id);
          });
          actionWrap.appendChild(userDel);
        }

        if (viewerIsPortfolioAdmin && reviewerSignedInUid && row.id !== reviewerSignedInUid) {
          var adminDel = document.createElement("button");
          adminDel.type = "button";
          adminDel.className = "rating-admin-delete-btn";
          adminDel.innerHTML =
            '<i class="ri-shield-star-line" aria-hidden="true"></i> Admin remove';
          adminDel.title = "Remove this review as site owner (portfolio admin UID)";
          adminDel.addEventListener("click", function () {
            deleteRatingFor(row.id);
          });
          actionWrap.appendChild(adminDel);
        }

        if (actionWrap.childNodes.length > 0) {
          rowTop.appendChild(actionWrap);
        }

        bodyEl.appendChild(rowTop);

        var quote = document.createElement("blockquote");
        quote.className = "rating-quote";
        quote.textContent = row.comment || "";

        var identity = document.createElement("div");
        identity.className = "rating-card__identity";

        var nameSpan = document.createElement("span");
        nameSpan.className = "rating-name";
        nameSpan.textContent = row.displayName || "Verified client";

        var roleSpan = document.createElement("span");
        roleSpan.className = "rating-role";
        roleSpan.textContent = row.email
          ? `${maskEmail(row.email)} · Gmail verified`
          : "Gmail verified";

        identity.appendChild(nameSpan);
        identity.appendChild(roleSpan);

        top.appendChild(avWrap);
        top.appendChild(bodyEl);
        card.appendChild(top);
        card.appendChild(quote);
        card.appendChild(identity);
        list.appendChild(card);
      });
    },
    (err) => {
      if (countMeta) {
        countMeta.textContent = "Could not load reviews. Check Firestore rules and indexes.";
      }
      console.error(err);
    }
  );

  window.__portfolioRatingsReady = true;
  } catch (err) {
    console.error(err);
    var failBanner = document.getElementById("ratings-config-banner");
    if (failBanner) {
      failBanner.classList.remove("hidden");
      failBanner.innerHTML =
        "<strong>Ratings could not start.</strong> Press F12 → Console and look for red errors. Open this site as <code>http://localhost/...</code> or your <code>github.io</code> page, not as a saved file (<code>file:///</code>).";
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initRatingsUi);
} else {
  initRatingsUi();
}
