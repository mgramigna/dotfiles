-- Buffer Appearance
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.wrap = false
vim.opt.hlsearch = false
vim.opt.cmdheight = 0

if vim.fn.has("termguicolors") == 1 then
	vim.opt.termguicolors = true
end

vim.opt.swapfile = false

vim.opt.updatetime = 50

-- Spacing
vim.opt.tabstop = 2
vim.opt.softtabstop = 0
vim.opt.shiftwidth = 2
vim.opt.expandtab = true

-- Spelling
vim.opt.spell = true
vim.opt.spelloptions = "camel"
