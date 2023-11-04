document.addEventListener('DOMContentLoaded', function () {
    const toc = document.querySelector('.table-of-contents');
    if (toc) {
        const title = document.createElement('div');
        title.className = 'custom-toc-title';
        title.innerText = 'On this page';
        toc.insertBefore(title, toc.firstChild);
    }
});  