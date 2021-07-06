source ~/.config/nvim/plugins/plugins.vim

" basics
filetype plugin indent on
set number
set relativenumber
set incsearch
set ignorecase
set smartcase
set nohlsearch
set tabstop=2
set softtabstop=0
set shiftwidth=2
set expandtab
set nobackup
set noswapfile
set nowrap
set autoread
set guifont=Anonymous\ Pro:h11

" navigate split screens easily
nmap <silent> <c-k> :wincmd k<CR>
nmap <silent> <c-j> :wincmd j<CR>
nmap <silent> <c-h> :wincmd h<CR>
nmap <silent> <c-l> :wincmd l<CR>

" change spacing for language specific
autocmd Filetype javascript setlocal ts=2 sts=2 sw=2
autocmd Filetype python setlocal ts=4 sts=4 sw=4

" close all buffers but this one
nnoremap <leader>bd :w <bar> %bd <bar> e#<CR>

" theme
if has('termguicolors')
  set termguicolors
endif

colorscheme dracula

" custom mappings
command! -nargs=0 Fjson :%!jq .
nmap <leader>p :Fjson<CR>
nmap <leader>sr :%s/\<<C-r><C-w>\>//gc<Left><Left><Left>

command! W w
command! Wq wq
command! Wqa wqa
command! Q q
command! Qa qa

xnoremap <Leader>lg "ayOconsole.log('<C-R>a:', <C-R>a);<Esc>
