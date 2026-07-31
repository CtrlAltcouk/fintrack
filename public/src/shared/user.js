export function createUserHelpers(esc) {
  function avatarCircle(user, size) {
    size = size || 36;
    const dimensions = 'width:' + size + 'px;height:' + size + 'px;border-radius:50%;object-fit:cover;flex-shrink:0';
    if (user.avatar) return '<img src="' + esc(user.avatar) + '" style="' + dimensions + '" alt="">';
    return '<div class="user-avatar-circle" style="background:' + esc(user.colour) + ';width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.4) + 'px">' + esc(user.display_name[0].toUpperCase()) + '</div>';
  }

  function applyUserPill(user) {
    const avatarEl = document.getElementById('user-pill-avatar');
    const sheetAvatarEl = document.getElementById('sheet-pill-avatar');
    const image = user.avatar
      ? `<img src="${esc(user.avatar)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
      : '';
    if (user.avatar) {
      avatarEl.innerHTML = image;
      sheetAvatarEl.innerHTML = image;
      avatarEl.style.background = '';
      sheetAvatarEl.style.background = '';
    } else {
      avatarEl.innerHTML = user.display_name[0].toUpperCase();
      sheetAvatarEl.innerHTML = user.display_name[0].toUpperCase();
      avatarEl.style.background = user.colour;
      sheetAvatarEl.style.background = user.colour;
    }
    document.getElementById('user-pill-name').textContent = user.display_name;
    document.getElementById('sheet-pill-name').textContent = user.display_name;
  }

  return { avatarCircle, applyUserPill };
}
